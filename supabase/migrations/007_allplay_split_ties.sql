-- All-play ties split the square's value evenly (rounded down to a whole
-- number): 600 between 3 teams is 200 each. Otherwise unchanged from 006.

create or replace function public.award_allplay(p_room_id uuid, p_team_ids uuid[], p_correct_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round int;
  v_question_id uuid;
  v_value int;
  v_winners uuid[];
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;

  select r.buzz_round, r.current_question_id, q.value into v_round, v_question_id, v_value
  from public.rooms r join public.questions q on q.id = r.current_question_id
  where r.id = p_room_id;
  if v_value is null then
    raise exception 'No question is showing';
  end if;

  update public.allplay_answers
  set correct = (id = any (coalesce(p_correct_ids, '{}')))
  where room_id = p_room_id and round = v_round and not removed;

  select coalesce(array_agg(t.id), '{}') into v_winners
  from public.teams t
  where t.room_id = p_room_id and t.id = any (coalesce(p_team_ids, '{}'));

  insert into public.score_events (room_id, team_id, question_id, points)
  select p_room_id, w, v_question_id, v_value / cardinality(v_winners) from unnest(v_winners) as w;

  update public.rooms
  set allplay = coalesce(allplay, '{}'::jsonb) || jsonb_build_object('winners', to_jsonb(v_winners)),
      allplay_ends_at = least(allplay_ends_at, now()),
      picking_team_id = case when cardinality(v_winners) = 1 then v_winners[1] else picking_team_id end
  where id = p_room_id;

  perform public.finish_question(p_room_id);
end;
$$;
