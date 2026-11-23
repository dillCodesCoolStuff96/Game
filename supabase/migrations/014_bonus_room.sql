-- The bonus room: a wheel slice. The team that spun flips hidden tiles one at
-- a time; the first symbol to turn up 3 times wins its prize. The tile layout
-- stays on the server so nobody can peek.

-- ---------- Setup (per board) ----------

-- { symbols: [{ emoji, points, count }] }: count = how many tiles carry it.
-- Cheaper prizes get more tiles, so they're more likely to be matched first.
alter table public.boards add column match3 jsonb not null default '{
  "symbols": [
    {"emoji": "🎄", "points": 100, "count": 7},
    {"emoji": "🎁", "points": 250, "count": 6},
    {"emoji": "⭐", "points": 500, "count": 4},
    {"emoji": "👑", "points": 1000, "count": 3}
  ]
}'::jsonb;

-- ---------- Live state ----------

-- Public: { team_id, status (playing | done), tiles (count), symbols (emoji +
-- points), revealed: [{ tile, symbol }], winner (symbol index), result }.
alter table public.rooms add column match3 jsonb;

-- The hidden layout: tile number -> symbol index. No one can read this table
-- directly; only the functions below use it.
create table public.match3_layouts (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  tiles jsonb not null
);
alter table public.match3_layouts enable row level security;
revoke all on public.match3_layouts from anon, authenticated;

-- Host opens the bonus room for a team (shuffles a fresh layout).
create function public.start_match3(p_room_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_symbols jsonb;
  v_tiles jsonb;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.room_id = p_room_id) then
    raise exception 'Team not found';
  end if;

  select b.match3 -> 'symbols' into v_symbols
  from public.boards b join public.rooms r on r.board_id = b.id
  where r.id = p_room_id;
  if coalesce(jsonb_array_length(v_symbols), 0) = 0 then
    raise exception 'Set up the bonus room in Set up questions first';
  end if;

  -- One entry per tile (symbol index repeated `count` times), shuffled.
  select coalesce(jsonb_agg(s.idx order by random()), '[]'::jsonb) into v_tiles
  from (
    select (e.ord - 1)::int as idx
    from jsonb_array_elements(v_symbols) with ordinality as e(sym, ord),
      generate_series(1, greatest((e.sym ->> 'count')::int, 0))
  ) s;

  insert into public.match3_layouts (room_id, tiles) values (p_room_id, v_tiles)
  on conflict (room_id) do update set tiles = excluded.tiles;

  update public.rooms
  set match3 = jsonb_build_object(
    'team_id', p_team_id,
    'status', 'playing',
    'tiles', jsonb_array_length(v_tiles),
    'symbols', (
      select jsonb_agg(jsonb_build_object('emoji', e.sym ->> 'emoji', 'points', (e.sym ->> 'points')::int) order by e.ord)
      from jsonb_array_elements(v_symbols) with ordinality as e(sym, ord)
    ),
    'revealed', '[]'::jsonb
  )
  where id = p_room_id;
end;
$$;

-- The team (or the host) flips a tile. Three of a kind wins that prize.
create function public.match3_pick(p_room_id uuid, p_tile int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_team_id uuid;
  v_symbol int;
  v_found int;
  v_points int;
  v_emoji text;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.match3 is null or v_room.match3 ->> 'status' <> 'playing' then
    return;
  end if;
  v_team_id := (v_room.match3 ->> 'team_id')::uuid;
  if not public.is_room_host(p_room_id) and public.my_team(p_room_id) is distinct from v_team_id then
    raise exception 'It''s not your team''s turn';
  end if;
  if p_tile < 0 or p_tile >= (v_room.match3 ->> 'tiles')::int then
    raise exception 'No such tile';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_room.match3 -> 'revealed') r
    where (r ->> 'tile')::int = p_tile
  ) then
    return; -- already flipped (e.g. a double tap)
  end if;

  select (l.tiles -> p_tile)::int into v_symbol from public.match3_layouts l where l.room_id = p_room_id;

  select count(*) + 1 into v_found
  from jsonb_array_elements(v_room.match3 -> 'revealed') r
  where (r ->> 'symbol')::int = v_symbol;

  update public.rooms
  set match3 = jsonb_set(
    match3, '{revealed}',
    (match3 -> 'revealed') || jsonb_build_array(jsonb_build_object('tile', p_tile, 'symbol', v_symbol))
  )
  where id = p_room_id;

  if v_found >= 3 then
    v_points := (v_room.match3 -> 'symbols' -> v_symbol ->> 'points')::int;
    v_emoji := v_room.match3 -> 'symbols' -> v_symbol ->> 'emoji';
    if v_points <> 0 then
      insert into public.score_events (room_id, team_id, points) values (p_room_id, v_team_id, v_points);
    end if;
    update public.rooms
    set match3 = match3 || jsonb_build_object(
      'status', 'done',
      'winner', v_symbol,
      'result', format('Three %s! %s%s points', v_emoji, case when v_points >= 0 then '+' else '' end, v_points)
    )
    where id = p_room_id;
  end if;
end;
$$;

create function public.close_match3(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  update public.rooms set match3 = null where id = p_room_id;
  delete from public.match3_layouts where room_id = p_room_id;
end;
$$;

revoke execute on function public.start_match3, public.match3_pick, public.close_match3 from public, anon;
grant execute on function public.start_match3, public.match3_pick, public.close_match3 to authenticated;

-- ---------- Wheel: new "Bonus room" slice ----------

create or replace function public.wheel_slice_label(p_slice jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_slice ->> 'type'
    when 'points' then '+' || (p_slice ->> 'amount')
    when 'lose' then '-' || (p_slice ->> 'amount')
    when 'double' then 'Double it!'
    when 'lose_question' then 'Lose it!'
    when 'lose_half' then 'Lose half'
    when 'steal' then 'Steal ' || (p_slice ->> 'amount')
    when 'bonus' then 'Bonus game'
    when 'bonus_room' then 'Bonus room'
    else '?'
  end;
$$;

-- Same as in 009, plus the bonus_room slice (status 'bonus_room'; the TV then
-- opens the room for the team).
create or replace function public.resolve_wheel(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_slice jsonb;
  v_team_id uuid;
  v_value int;
  v_amount int;
  v_points int;
  v_score int;
  v_status text := 'done';
  v_result text;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.wheel is null or v_room.wheel ->> 'status' <> 'spinning' then
    return;
  end if;

  select b.wheel -> 'slices' -> ((v_room.wheel ->> 'slice')::int) into v_slice
  from public.boards b where b.id = v_room.board_id;
  v_team_id := (v_room.wheel ->> 'team_id')::uuid;
  v_value := coalesce((v_room.wheel ->> 'value')::int, 0);
  v_amount := coalesce((v_slice ->> 'amount')::int, 0);
  select t.score into v_score from public.teams t where t.id = v_team_id;

  case v_slice ->> 'type'
    when 'points' then
      v_points := v_amount;
      v_result := format('+%s points!', v_amount);
    when 'lose' then
      v_points := -v_amount;
      v_result := format('Lose %s points', v_amount);
    when 'double' then
      v_points := v_value;
      v_result := format('Doubled! +%s', v_value);
    when 'lose_question' then
      v_points := -v_value;
      v_result := format('Lose it! -%s', v_value);
    when 'lose_half' then
      v_points := -(greatest(coalesce(v_score, 0), 0) / 2);
      v_result := format('Lose half! -%s', -v_points);
    when 'steal' then
      v_status := 'choose';
      v_result := format('Steal %s — pick a team!', v_amount);
    when 'bonus' then
      v_status := 'bonus';
      v_result := 'Bonus game!';
    when 'bonus_room' then
      v_status := 'bonus_room';
      v_result := 'Bonus room!';
    else
      v_result := 'Nothing happens';
  end case;

  if coalesce(v_points, 0) <> 0 then
    insert into public.score_events (room_id, team_id, points) values (p_room_id, v_team_id, v_points);
  end if;

  update public.rooms
  set wheel = wheel || jsonb_build_object(
    'status', v_status,
    'result', v_result,
    'label', public.wheel_slice_label(v_slice),
    'amount', v_amount
  )
  where id = p_room_id;
end;
$$;

-- Add a Bonus room slice to every existing wheel that doesn't have one.
update public.boards
set wheel = jsonb_set(wheel, '{slices}', (wheel -> 'slices') || '[{"type": "bonus_room"}]'::jsonb)
where not (wheel -> 'slices') @> '[{"type": "bonus_room"}]'::jsonb;

alter table public.boards alter column wheel set default '{
  "chance": 0.25,
  "slices": [
    {"type": "points", "amount": 100},
    {"type": "double"},
    {"type": "lose", "amount": 200},
    {"type": "points", "amount": 250},
    {"type": "steal", "amount": 200},
    {"type": "lose_question"},
    {"type": "points", "amount": 500},
    {"type": "lose_half"},
    {"type": "bonus"},
    {"type": "points", "amount": 100},
    {"type": "bonus_room"}
  ]
}'::jsonb;
