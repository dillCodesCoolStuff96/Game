-- Host can add or take away points for any team at any time. Recorded as a
-- score event like any other, so "Undo last score" can take it back.

create function public.adjust_score(p_team_id uuid, p_points int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  select t.room_id into v_room_id from public.teams t where t.id = p_team_id;
  if v_room_id is null or not public.is_room_host(v_room_id) then
    raise exception 'Only the host can adjust scores';
  end if;
  if p_points = 0 then
    return;
  end if;

  insert into public.score_events (room_id, team_id, points)
  values (v_room_id, p_team_id, p_points);
end;
$$;

revoke execute on function public.adjust_score from public, anon;
grant execute on function public.adjust_score to authenticated;
