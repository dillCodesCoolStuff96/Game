-- When a team's answer time runs out, the host's TV marks their buzz as
-- expired and the team may buzz again (joining the back of the line).

alter table public.buzzes add column expired boolean not null default false;

-- One *active* buzz per team per round (expired ones don't count).
alter table public.buzzes drop constraint buzzes_room_id_round_team_id_key;
create unique index buzzes_one_active_per_team
  on public.buzzes (room_id, round, team_id) where not expired;

grant update (expired) on public.buzzes to authenticated;
create policy "host expires buzzes" on public.buzzes
  for update to authenticated
  using (public.is_room_host(room_id))
  with check (public.is_room_host(room_id));

-- Same as before, but only counts active buzzes. Returns the team's place in
-- line among active buzzes (1 = first), or null if the buzzers are closed.
create or replace function public.buzz(p_room_id uuid)
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
  on conflict (room_id, round, team_id) where not expired do nothing;

  select b.id into v_buzz_id
  from public.buzzes b
  where b.room_id = p_room_id and b.round = v_round and b.team_id = v_team_id and not b.expired;

  return (
    select count(*)::int from public.buzzes b
    where b.room_id = p_room_id and b.round = v_round and not b.expired and b.id <= v_buzz_id
  );
end;
$$;
