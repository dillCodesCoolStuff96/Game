-- Bonus room: when a symbol wins, reveal the whole layout so everyone can see
-- where every symbol was hiding. Otherwise unchanged from 014. (The layout is
-- already shuffled fresh every time the room opens.)

-- The team (or the host) flips a tile. Three of a kind wins that prize.
create or replace function public.match3_pick(p_room_id uuid, p_tile int)
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
      -- Game over: show where every symbol was.
      'layout', (select l.tiles from public.match3_layouts l where l.room_id = p_room_id),
      'result', format('Three %s! %s%s points', v_emoji, case when v_points >= 0 then '+' else '' end, v_points)
    )
    where id = p_room_id;
  end if;
end;
$$;
