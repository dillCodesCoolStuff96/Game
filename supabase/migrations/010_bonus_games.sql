-- Bonus games (rapid fire), reached from the wheel's Bonus slice.
-- The team can keep the points they just won, or trade them to play: items
-- appear on the TV one at a time for a set time, the host marks each correct
-- or pass, and the team scores multiplier x correct x points each, where the
-- multiplier is the points they just won / 100 (500 -> 5).
--
-- Each bonus category is a deck, so more categories (and difficulty levels)
-- can be added later without changing how the game works.

-- ---------- Decks (host only) ----------

create table public.bonus_decks (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- Free label for later (e.g. easy / medium / hard); not used in play yet.
  difficulty text,
  points_per int not null default 5 check (points_per >= 0),
  seconds int not null default 60 check (seconds between 10 and 600),
  -- [{ prompt?, image_url?, answer }]
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.bonus_decks enable row level security;
revoke all on public.bonus_decks from anon, authenticated;
grant select, insert, update, delete on public.bonus_decks to authenticated;

create policy "owner manages bonus decks" on public.bonus_decks
  for all to authenticated
  using (public.owns_board(board_id))
  with check (public.owns_board(board_id));

-- ---------- Live state ----------

-- { team_id, deck_id, name, value, multiplier, points_per, seconds, status,
--   order, index, correct, ends_at, total, result }
-- status: offer (play or keep?) -> ready (waiting for the host to start) ->
-- playing -> done. Never contains answers.
alter table public.rooms add column bonus jsonb;

-- Host offers a bonus game to a team (picks one of the board's decks at random).
create function public.start_bonus(p_room_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deck public.bonus_decks;
  v_value int;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.room_id = p_room_id) then
    raise exception 'Team not found';
  end if;

  select d.* into v_deck
  from public.bonus_decks d join public.rooms r on r.board_id = d.board_id
  where r.id = p_room_id and jsonb_array_length(d.items) > 0
  order by random()
  limit 1;
  if v_deck.id is null then
    raise exception 'Add a bonus game in Set up questions first';
  end if;

  -- The points this team most recently won on a question: what they'd trade.
  select e.points into v_value
  from public.score_events e
  where e.room_id = p_room_id and e.team_id = p_team_id
    and e.question_id is not null and e.points > 0
  order by e.id desc
  limit 1;
  v_value := coalesce(v_value, 0);

  update public.rooms
  set bonus = jsonb_build_object(
    'team_id', p_team_id,
    'deck_id', v_deck.id,
    'name', v_deck.name,
    'difficulty', v_deck.difficulty,
    'value', v_value,
    'multiplier', greatest(1, v_value / 100),
    'points_per', v_deck.points_per,
    'seconds', v_deck.seconds,
    'status', 'offer'
  )
  where id = p_room_id;
end;
$$;

-- The team (or the host) decides: play (give up the points) or keep them.
create function public.bonus_choose(p_room_id uuid, p_play boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_team_id uuid;
  v_value int;
  v_count int;
  v_order jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.bonus is null or v_room.bonus ->> 'status' <> 'offer' then
    return; -- already decided (e.g. two teammates tapped at once)
  end if;
  v_team_id := (v_room.bonus ->> 'team_id')::uuid;
  if not public.is_room_host(p_room_id) and public.my_team(p_room_id) is distinct from v_team_id then
    raise exception 'It''s not your team''s choice';
  end if;
  v_value := coalesce((v_room.bonus ->> 'value')::int, 0);

  if not p_play then
    update public.rooms
    set bonus = bonus || jsonb_build_object(
      'status', 'done', 'kept', true, 'result', format('Kept their %s points', v_value)
    )
    where id = p_room_id;
    return;
  end if;

  -- Trade in the points, and shuffle the deck.
  if v_value > 0 then
    insert into public.score_events (room_id, team_id, points) values (p_room_id, v_team_id, -v_value);
  end if;
  select jsonb_array_length(d.items) into v_count
  from public.bonus_decks d where d.id = (v_room.bonus ->> 'deck_id')::uuid;
  select coalesce(jsonb_agg(i order by random()), '[]'::jsonb) into v_order
  from generate_series(0, coalesce(v_count, 0) - 1) as i;

  update public.rooms
  set bonus = bonus || jsonb_build_object('status', 'ready', 'order', v_order, 'index', 0, 'correct', 0)
  where id = p_room_id;
end;
$$;

-- Host starts the clock (server time, so every screen agrees).
create function public.bonus_start(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  update public.rooms
  set bonus = bonus || jsonb_build_object(
    'status', 'playing',
    'ends_at', now() + make_interval(secs => coalesce((bonus ->> 'seconds')::int, 60))
  )
  where id = p_room_id and bonus ->> 'status' = 'ready';
end;
$$;

-- Host marks the item on screen correct or passed; the next one shows.
create function public.bonus_mark(p_room_id uuid, p_correct boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  update public.rooms
  set bonus = bonus || jsonb_build_object(
    'index', (bonus ->> 'index')::int + 1,
    'correct', (bonus ->> 'correct')::int + case when p_correct then 1 else 0 end
  )
  where id = p_room_id
    and bonus ->> 'status' = 'playing'
    and now() <= (bonus ->> 'ends_at')::timestamptz + interval '1 second'
    and (bonus ->> 'index')::int < jsonb_array_length(bonus -> 'order');
end;
$$;

-- Time's up (or the items ran out, or the host ends it): score the round.
create function public.bonus_finish(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bonus jsonb;
  v_correct int;
  v_multiplier int;
  v_points_per int;
  v_total int;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  select r.bonus into v_bonus from public.rooms r where r.id = p_room_id;
  if v_bonus is null or v_bonus ->> 'status' not in ('ready', 'playing') then
    return;
  end if;

  v_correct := coalesce((v_bonus ->> 'correct')::int, 0);
  v_multiplier := coalesce((v_bonus ->> 'multiplier')::int, 1);
  v_points_per := coalesce((v_bonus ->> 'points_per')::int, 0);
  v_total := v_multiplier * v_correct * v_points_per;

  if v_total > 0 then
    insert into public.score_events (room_id, team_id, points)
    values (p_room_id, (v_bonus ->> 'team_id')::uuid, v_total);
  end if;

  update public.rooms
  set bonus = bonus || jsonb_build_object(
    'status', 'done',
    'total', v_total,
    'result', format('%s right × %s × %s = %s points', v_correct, v_multiplier, v_points_per, v_total)
  )
  where id = p_room_id;
end;
$$;

create function public.close_bonus(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  update public.rooms set bonus = null where id = p_room_id;
end;
$$;

revoke execute on function public.start_bonus, public.bonus_choose, public.bonus_start,
  public.bonus_mark, public.bonus_finish, public.close_bonus from public, anon;
grant execute on function public.start_bonus, public.bonus_choose, public.bonus_start,
  public.bonus_mark, public.bonus_finish, public.close_bonus to authenticated;

-- ---------- Sample deck ----------
-- Give existing sample boards a "World capitals" deck to try (new sample
-- boards get it from the app).

insert into public.bonus_decks (board_id, name, items)
select b.id, 'World capitals', '[
  {"prompt": "France", "answer": "Paris"}, {"prompt": "Japan", "answer": "Tokyo"},
  {"prompt": "Italy", "answer": "Rome"}, {"prompt": "Canada", "answer": "Ottawa"},
  {"prompt": "Australia", "answer": "Canberra"}, {"prompt": "Spain", "answer": "Madrid"},
  {"prompt": "Germany", "answer": "Berlin"}, {"prompt": "Egypt", "answer": "Cairo"},
  {"prompt": "Brazil", "answer": "Brasília"}, {"prompt": "Mexico", "answer": "Mexico City"},
  {"prompt": "Russia", "answer": "Moscow"}, {"prompt": "India", "answer": "New Delhi"},
  {"prompt": "China", "answer": "Beijing"}, {"prompt": "Kenya", "answer": "Nairobi"},
  {"prompt": "Argentina", "answer": "Buenos Aires"}, {"prompt": "Norway", "answer": "Oslo"},
  {"prompt": "Greece", "answer": "Athens"}, {"prompt": "Thailand", "answer": "Bangkok"},
  {"prompt": "Peru", "answer": "Lima"}, {"prompt": "Ireland", "answer": "Dublin"}
]'::jsonb
from public.boards b
where b.title = 'Sample board'
  and not exists (select 1 from public.bonus_decks d where d.board_id = b.id);
