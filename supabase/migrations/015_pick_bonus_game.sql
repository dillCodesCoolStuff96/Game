-- After the wheel's Bonus game slice, the team picks which bonus game to play
-- from a list (each rapid-fire deck for now; more kinds of bonus game later).
-- The Bonus room slice still goes straight into the bonus room.

-- Host's TV puts the list up: p_options = [{ kind: 'deck', id, name }].
create function public.offer_bonus_choice(p_room_id uuid, p_options jsonb)
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
  set wheel = wheel || jsonb_build_object('status', 'pick', 'options', p_options)
  where id = p_room_id and wheel ->> 'status' = 'bonus';
end;
$$;

-- The team that spun (or the host) picks one; the TV then starts it.
create function public.choose_bonus(p_room_id uuid, p_option int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.wheel is null or v_room.wheel ->> 'status' <> 'pick' then
    return; -- already chosen (e.g. two teammates tapped at once)
  end if;
  if not public.is_room_host(p_room_id)
     and public.my_team(p_room_id) is distinct from (v_room.wheel ->> 'team_id')::uuid then
    raise exception 'It''s not your team''s choice';
  end if;
  if p_option < 0 or p_option >= jsonb_array_length(v_room.wheel -> 'options') then
    raise exception 'No such bonus game';
  end if;
  update public.rooms
  set wheel = wheel || jsonb_build_object('status', 'chosen', 'choice', p_option)
  where id = p_room_id;
end;
$$;

-- start_bonus can now be told which deck to use (null = random, as before).
drop function public.start_bonus(uuid, uuid);
create function public.start_bonus(p_room_id uuid, p_team_id uuid, p_deck_id uuid default null)
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
    and (p_deck_id is null or d.id = p_deck_id)
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

revoke execute on function public.offer_bonus_choice, public.choose_bonus, public.start_bonus from public, anon;
grant execute on function public.offer_bonus_choice, public.choose_bonus, public.start_bonus to authenticated;
