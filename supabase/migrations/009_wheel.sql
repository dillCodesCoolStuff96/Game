-- The wheel: after a correct answer (by chance, or when the host triggers it)
-- the team spins on their phones and the wheel spins on the TV. The server
-- picks the slice, so nobody can rig it.
--
-- Slice types: points (+amount), lose (-amount), double (+ the points they
-- just won), lose_question (- the points they just won), lose_half (half
-- their score), steal (take amount from a team they pick), bonus (bonus
-- games, coming later).

-- ---------- Wheel setup (per board) ----------

-- { chance (0-1, after a correct answer), slices: [{ type, amount? }] }
alter table public.boards add column wheel jsonb not null default '{
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
    {"type": "points", "amount": 100}
  ]
}'::jsonb;

-- ---------- Live state ----------

-- { team_id, status, value, slice, result, amount }
-- status: ready (waiting for the team to spin) -> spinning -> choose (steal:
-- pick a team) / bonus / done. value = the points the team just won.
alter table public.rooms add column wheel jsonb;

-- Short text for a slice, used in results ("+250", "Steal 200", ...).
create function public.wheel_slice_label(p_slice jsonb)
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
    else '?'
  end;
$$;

-- Host shows the wheel for a team.
create function public.start_wheel(p_room_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value int;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.room_id = p_room_id) then
    raise exception 'Team not found';
  end if;

  -- The points this team most recently won on a question (for Double / Lose it).
  select e.points into v_value
  from public.score_events e
  where e.room_id = p_room_id and e.team_id = p_team_id
    and e.question_id is not null and e.points > 0
  order by e.id desc
  limit 1;

  update public.rooms
  set wheel = jsonb_build_object('team_id', p_team_id, 'status', 'ready', 'value', coalesce(v_value, 0))
  where id = p_room_id;
end;
$$;

-- The spinning team (or the host) spins: the server picks the slice.
create function public.spin_wheel(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_slices jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.wheel is null or v_room.wheel ->> 'status' <> 'ready' then
    return; -- already spun (e.g. two teammates tapped at once)
  end if;
  if not public.is_room_host(p_room_id)
     and public.my_team(p_room_id) is distinct from (v_room.wheel ->> 'team_id')::uuid then
    raise exception 'It''s not your team''s spin';
  end if;

  select b.wheel -> 'slices' into v_slices from public.boards b where b.id = v_room.board_id;
  if coalesce(jsonb_array_length(v_slices), 0) = 0 then
    raise exception 'This wheel has no slices';
  end if;

  update public.rooms
  set wheel = wheel || jsonb_build_object(
    'status', 'spinning',
    'slice', floor(random() * jsonb_array_length(v_slices))::int
  )
  where id = p_room_id;
end;
$$;

-- The TV calls this when the spin animation stops: apply the slice.
create function public.resolve_wheel(p_room_id uuid)
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

-- After a Steal slice: the spinning team (or the host) picks who to take from.
create function public.wheel_steal(p_room_id uuid, p_target_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_team_id uuid;
  v_amount int;
  v_target_name text;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.wheel is null or v_room.wheel ->> 'status' <> 'choose' then
    return;
  end if;
  v_team_id := (v_room.wheel ->> 'team_id')::uuid;
  if not public.is_room_host(p_room_id) and public.my_team(p_room_id) is distinct from v_team_id then
    raise exception 'It''s not your team''s steal';
  end if;

  select t.name into v_target_name
  from public.teams t
  where t.id = p_target_team_id and t.room_id = p_room_id and t.id <> v_team_id;
  if v_target_name is null then
    raise exception 'Pick another team';
  end if;

  v_amount := coalesce((v_room.wheel ->> 'amount')::int, 0);
  insert into public.score_events (room_id, team_id, points)
  values (p_room_id, p_target_team_id, -v_amount), (p_room_id, v_team_id, v_amount);

  update public.rooms
  set wheel = wheel || jsonb_build_object(
    'status', 'done',
    'result', format('Stole %s from %s!', v_amount, v_target_name)
  )
  where id = p_room_id;
end;
$$;

-- Host closes the wheel.
create function public.close_wheel(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;
  update public.rooms set wheel = null where id = p_room_id;
end;
$$;

revoke execute on function public.start_wheel, public.spin_wheel, public.resolve_wheel,
  public.wheel_steal, public.close_wheel from public, anon;
grant execute on function public.start_wheel, public.spin_wheel, public.resolve_wheel,
  public.wheel_steal, public.close_wheel to authenticated;
