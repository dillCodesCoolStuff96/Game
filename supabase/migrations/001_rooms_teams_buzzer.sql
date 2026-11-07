-- Step 1: live game rooms, teams, players and the buzzer.
-- The host (email account) creates a room; players (anonymous sign-in)
-- join it by code, pick a team, and buzz. Several players can share a team.

-- ---------- Tables ----------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references auth.users (id) on delete cascade,
  -- Opening the buzzers starts a new round, which clears the previous buzzes.
  buzz_round int not null default 0,
  buzz_open boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  score int not null default 0,
  created_at timestamptz not null default now(),
  unique (room_id, name)
);

create table public.players (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  name text not null check (char_length(name) between 1 and 30),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table public.buzzes (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  round int not null,
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Server time, so a phone's clock can't affect who was first.
  buzzed_at timestamptz not null default clock_timestamp(),
  -- One buzz per team per round, no matter how many phones the team has.
  unique (room_id, round, team_id)
);

-- ---------- Helpers ----------

-- Host or joined player. Security definer so policies on players can use it
-- without recursing into players' own policies.
create function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = auth.uid())
      or exists (select 1 from public.players p where p.room_id = p_room_id and p.user_id = auth.uid());
$$;

create function public.is_room_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rooms r where r.id = p_room_id and r.host_id = auth.uid());
$$;

-- ---------- Row Level Security ----------

alter table public.rooms enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.buzzes enable row level security;

-- Only specific columns are writable from the app; everything else goes through
-- the functions below.
revoke all on public.rooms, public.teams, public.players, public.buzzes from anon, authenticated;
grant select on public.rooms, public.teams, public.players, public.buzzes to authenticated;
grant update (buzz_open, buzz_round) on public.rooms to authenticated;
grant delete on public.rooms to authenticated;
grant insert (room_id, name) on public.teams to authenticated;
grant update (name, score) on public.teams to authenticated;
grant delete on public.teams to authenticated;
grant update (team_id, name) on public.players to authenticated;
grant delete on public.players to authenticated;

create policy "members see their room" on public.rooms
  for select to authenticated using (public.is_room_member(id));
create policy "host updates room" on public.rooms
  for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy "host deletes room" on public.rooms
  for delete to authenticated using (host_id = auth.uid());

create policy "members see teams" on public.teams
  for select to authenticated using (public.is_room_member(room_id));
create policy "members create teams" on public.teams
  for insert to authenticated with check (public.is_room_member(room_id));
create policy "host updates teams" on public.teams
  for update to authenticated using (public.is_room_host(room_id));
create policy "host deletes teams" on public.teams
  for delete to authenticated using (public.is_room_host(room_id));

create policy "members see players" on public.players
  for select to authenticated using (public.is_room_member(room_id));
create policy "players change their own team" on public.players
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (team_id is null or exists (
      select 1 from public.teams t where t.id = team_id and t.room_id = players.room_id
    ))
  );
create policy "players leave or host removes" on public.players
  for delete to authenticated
  using (user_id = auth.uid() or public.is_room_host(room_id));

create policy "members see buzzes" on public.buzzes
  for select to authenticated using (public.is_room_member(room_id));

-- ---------- Functions the app calls ----------

-- Host creates a room with a random 4-letter code (no vowels, so no words).
create function public.create_room()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet text := 'BCDFGHJKLMNPQRSTVWXZ';
  v_code text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to host a game';
  end if;

  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into public.rooms (code, host_id) values (v_code, auth.uid());
      return v_code;
    exception when unique_violation then
      -- Code already used; try another.
    end;
  end loop;
end;
$$;

-- Player joins a room by code (or renames themselves if already in it).
create function public.join_room(p_code text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select r.id into v_room_id from public.rooms r where r.code = upper(trim(p_code));
  if v_room_id is null then
    raise exception 'No game found with code %', upper(trim(p_code));
  end if;

  insert into public.players (room_id, user_id, name)
  values (v_room_id, auth.uid(), trim(p_name))
  on conflict (room_id, user_id) do update set name = excluded.name;

  return v_room_id;
end;
$$;

-- Player buzzes for their team. Returns the team's place in line
-- (1 = first), or null if the buzzers are closed.
create function public.buzz(p_room_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_round int;
  v_open boolean;
  v_buzz_id bigint;
begin
  select p.team_id into v_team_id
  from public.players p
  where p.room_id = p_room_id and p.user_id = auth.uid();
  if v_team_id is null then
    raise exception 'Join a team first';
  end if;

  select r.buzz_round, r.buzz_open into v_round, v_open
  from public.rooms r where r.id = p_room_id;
  if not v_open then
    return null;
  end if;

  insert into public.buzzes (room_id, round, team_id, user_id)
  values (p_room_id, v_round, v_team_id, auth.uid())
  on conflict (room_id, round, team_id) do nothing;

  select b.id into v_buzz_id
  from public.buzzes b
  where b.room_id = p_room_id and b.round = v_round and b.team_id = v_team_id;

  return (
    select count(*)::int from public.buzzes b
    where b.room_id = p_room_id and b.round = v_round and b.id <= v_buzz_id
  );
end;
$$;

revoke execute on function public.is_room_member, public.is_room_host,
  public.create_room, public.join_room, public.buzz from public, anon;
grant execute on function public.is_room_member, public.is_room_host,
  public.create_room, public.join_room, public.buzz to authenticated;

-- ---------- Realtime ----------

-- Screens subscribe to changes in these tables to update live.
alter publication supabase_realtime
  add table public.rooms, public.teams, public.players, public.buzzes;
