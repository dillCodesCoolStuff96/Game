-- A team that answers wrong may buzz again right away (each wrong answer
-- still costs half the value). Previously only a timeout freed them.

-- One *waiting* buzz per team per round: timed-out and judged buzzes don't count.
drop index public.buzzes_one_active_per_team;
create unique index buzzes_one_waiting_per_team
  on public.buzzes (room_id, round, team_id) where not expired and result is null;

-- Returns the team's place among buzzes still waiting (1 = first), or null if
-- the buzzers are closed.
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
  on conflict (room_id, round, team_id) where not expired and result is null do nothing;

  select b.id into v_buzz_id
  from public.buzzes b
  where b.room_id = p_room_id and b.round = v_round and b.team_id = v_team_id
    and not b.expired and b.result is null;

  return (
    select count(*)::int from public.buzzes b
    where b.room_id = p_room_id and b.round = v_round
      and not b.expired and b.result is null and b.id <= v_buzz_id
  );
end;
$$;

-- Tidy-up: guest (anonymous) players can't create boards.
create policy "only host accounts create boards" on public.boards
  as restrictive
  for insert to authenticated
  with check (not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));
