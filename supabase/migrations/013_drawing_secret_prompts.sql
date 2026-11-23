-- Drawing questions: each team gets its own secret prompt (picked from the
-- question's list when the square opens), and the judge writes longer roasts.

-- Allow longer judge comments (2-3 sentences). Otherwise unchanged from 012.
create or replace function public.save_drawing_verdicts(p_room_id uuid, p_verdicts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;

  update public.drawings d
  set score = least(10, greatest(0, (v ->> 'score')::int)),
      comment = left(v ->> 'comment', 800)
  from jsonb_array_elements(p_verdicts) as v
  where d.id = (v ->> 'id')::bigint and d.room_id = p_room_id;

  update public.rooms
  set allplay = coalesce(allplay, '{}'::jsonb) || jsonb_build_object('judged', true)
  where id = p_room_id;
end;
$$;

-- Give the sample drawing square five secret prompts.
update public.questions q
set prompt = 'Secret drawing challenge!',
    allplay = '{"seconds": 180, "prompts": [
      "Santa on summer vacation",
      "A reindeer at the gym",
      "The Grinch doing his taxes",
      "A snowman in a heat wave",
      "Elves on strike"
    ]}'
from public.categories c join public.boards b on b.id = c.board_id
where q.category_id = c.id and b.title = 'Sample board' and q.kind = 'drawing';
