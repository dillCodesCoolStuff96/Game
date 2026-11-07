-- Step 3: all-play questions. Every team answers on their phones at once;
-- the host grades each answer and the team(s) with the most correct win the
-- square's value.
--
-- Formats: 'list' (add as many answers as you can), 'blanks' (fixed labelled
-- boxes: fill-in-the-blank, matching, ranking) and 'single' (one box).

-- ---------- Questions ----------

alter table public.questions
  add column kind text not null default 'buzz' check (kind in ('buzz', 'allplay')),
  -- { format, seconds, items: [{ label?, answer }] }. For lists, items are the
  -- answer key; for blanks, one item per box. "a/b" in an answer accepts either.
  add column allplay jsonb;

-- ---------- Live state ----------

alter table public.rooms
  -- Public part of the all-play question on screen (never the answers):
  -- { format, prompt, labels, seconds, winners }.
  add column allplay jsonb,
  -- When answers lock (null = not started yet).
  add column allplay_ends_at timestamptz;

grant update (allplay, allplay_ends_at) on public.rooms to authenticated;

create table public.allplay_answers (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  -- The room's buzz_round, which identifies one showing of a question.
  round int not null,
  team_id uuid not null references public.teams (id) on delete cascade,
  -- Box number for blanks/single; null for list answers.
  slot int,
  text text not null default '' check (char_length(text) <= 100),
  -- Rows are never deleted (live updates can't filter deletes), only flagged.
  removed boolean not null default false,
  -- Host's verdict (null = not graded).
  correct boolean,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index allplay_one_answer_per_box
  on public.allplay_answers (room_id, round, team_id, slot) where slot is not null;

-- The signed-in player's team in a room (null if none).
create function public.my_team(p_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.team_id from public.players p where p.room_id = p_room_id and p.user_id = auth.uid();
$$;

alter table public.allplay_answers enable row level security;
revoke all on public.allplay_answers from anon, authenticated;
grant select on public.allplay_answers to authenticated;
grant update (correct) on public.allplay_answers to authenticated;

-- Players only see their own team's answers, so nobody can copy.
create policy "host and own team see answers" on public.allplay_answers
  for select to authenticated
  using (public.is_room_host(room_id) or team_id = public.my_team(room_id));
create policy "host grades answers" on public.allplay_answers
  for update to authenticated
  using (public.is_room_host(room_id))
  with check (public.is_room_host(room_id));

-- ---------- Functions players call ----------

-- The caller's team, if an all-play question in one of these formats is
-- taking answers. Allows one second of grace for slow connections.
create function public.allplay_open_team(p_room_id uuid, p_formats text[])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_room public.rooms;
begin
  v_team_id := public.my_team(p_room_id);
  if v_team_id is null then
    raise exception 'Join a team first';
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  if v_room.phase <> 'question' or v_room.allplay is null
     or not (v_room.allplay ->> 'format' = any (p_formats)) then
    raise exception 'No all-play question is open';
  end if;
  if v_room.allplay_ends_at is null or now() > v_room.allplay_ends_at + interval '1 second' then
    raise exception 'Answers are locked';
  end if;

  return v_team_id;
end;
$$;

-- Add an answer to the team's list (duplicates are ignored).
create function public.allplay_add(p_room_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_round int;
  v_text text := trim(p_text);
begin
  v_team_id := public.allplay_open_team(p_room_id, array['list']);
  if v_text = '' then
    return;
  end if;

  select r.buzz_round into v_round from public.rooms r where r.id = p_room_id;
  if exists (
    select 1 from public.allplay_answers a
    where a.room_id = p_room_id and a.round = v_round and a.team_id = v_team_id
      and not a.removed and lower(a.text) = lower(v_text)
  ) then
    return;
  end if;

  insert into public.allplay_answers (room_id, round, team_id, text, updated_by)
  values (p_room_id, v_round, v_team_id, v_text, auth.uid());
end;
$$;

-- Remove an answer from the team's list.
create function public.allplay_remove(p_answer_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answer public.allplay_answers;
begin
  select * into v_answer from public.allplay_answers where id = p_answer_id;
  if v_answer.id is null then
    raise exception 'Answer not found';
  end if;
  if v_answer.team_id <> public.allplay_open_team(v_answer.room_id, array['list']) then
    raise exception 'That is not your team''s answer';
  end if;

  update public.allplay_answers set removed = true, updated_by = auth.uid() where id = p_answer_id;
end;
$$;

-- Fill in one box (blanks/single). An empty text clears it.
create function public.allplay_set(p_room_id uuid, p_slot int, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_round int;
  v_allplay jsonb;
  v_boxes int;
begin
  v_team_id := public.allplay_open_team(p_room_id, array['blanks', 'single']);

  select r.buzz_round, r.allplay into v_round, v_allplay from public.rooms r where r.id = p_room_id;
  v_boxes := case
    when v_allplay ->> 'format' = 'single' then 1
    else jsonb_array_length(coalesce(v_allplay -> 'labels', '[]'::jsonb))
  end;
  if p_slot < 0 or p_slot >= v_boxes then
    raise exception 'No such box';
  end if;

  insert into public.allplay_answers (room_id, round, team_id, slot, text, updated_by)
  values (p_room_id, v_round, v_team_id, p_slot, left(trim(p_text), 100), auth.uid())
  on conflict (room_id, round, team_id, slot) where slot is not null
  do update set text = excluded.text, updated_by = excluded.updated_by;
end;
$$;

-- ---------- Functions the host's TV calls ----------

-- Start the countdown (p_seconds > 0) or lock answers now (0). Uses the
-- server's clock so every screen agrees.
create function public.set_allplay_timer(p_room_id uuid, p_seconds int)
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
  set allplay_ends_at = now() + make_interval(secs => greatest(p_seconds, 0))
  where id = p_room_id;
end;
$$;

-- Save the grading, give the winners the square's value (one winner also
-- picks next), and show the answer.
create function public.award_allplay(p_room_id uuid, p_team_ids uuid[], p_correct_ids bigint[])
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
  select p_room_id, w, v_question_id, v_value from unnest(v_winners) as w;

  update public.rooms
  set allplay = coalesce(allplay, '{}'::jsonb) || jsonb_build_object('winners', to_jsonb(v_winners)),
      allplay_ends_at = least(allplay_ends_at, now()),
      picking_team_id = case when cardinality(v_winners) = 1 then v_winners[1] else picking_team_id end
  where id = p_room_id;

  perform public.finish_question(p_room_id);
end;
$$;

-- my_team is used by the answers' read rule, so signed-in users need it;
-- allplay_open_team is only called from the functions above.
revoke execute on function public.my_team from public, anon;
grant execute on function public.my_team to authenticated;
revoke execute on function public.allplay_open_team from public, anon, authenticated;
revoke execute on function public.allplay_add, public.allplay_remove, public.allplay_set,
  public.set_allplay_timer, public.award_allplay from public, anon;
grant execute on function public.allplay_add, public.allplay_remove, public.allplay_set,
  public.set_allplay_timer, public.award_allplay to authenticated;

alter publication supabase_realtime add table public.allplay_answers;

-- ---------- Sample board examples ----------
-- Turn three squares on existing sample boards into all-play questions, one
-- of each format (new sample boards get these from the app).

update public.questions q
set kind = 'allplay',
    prompt = 'Name all seven continents.',
    answer = 'Africa, Antarctica, Asia, Australia, Europe, North America, South America',
    allplay = '{"format": "list", "seconds": 60, "items": [
      {"answer": "Africa"}, {"answer": "Antarctica"}, {"answer": "Asia"},
      {"answer": "Australia/Oceania"}, {"answer": "Europe"},
      {"answer": "North America"}, {"answer": "South America"}]}'
from public.categories c join public.boards b on b.id = c.board_id
where q.category_id = c.id and b.title = 'Sample board' and c.name = 'Geography' and q.value = 400;

update public.questions q
set kind = 'allplay',
    prompt = 'Match each Christmas song to the singer who made it famous.',
    answer = 'Wham!, Brenda Lee, José Feliciano, Elvis Presley',
    allplay = '{"format": "blanks", "seconds": 60, "items": [
      {"label": "Last Christmas", "answer": "Wham!/Wham/George Michael"},
      {"label": "Rockin'' Around the Christmas Tree", "answer": "Brenda Lee"},
      {"label": "Feliz Navidad", "answer": "José Feliciano"},
      {"label": "Blue Christmas", "answer": "Elvis Presley/Elvis"}]}'
from public.categories c join public.boards b on b.id = c.board_id
where q.category_id = c.id and b.title = 'Sample board' and c.name = 'Music' and q.value = 300;

update public.questions q
set kind = 'allplay',
    prompt = 'Which movie has the line "You''ll shoot your eye out!"?',
    answer = 'A Christmas Story',
    allplay = '{"format": "single", "seconds": 30, "items": [
      {"answer": "A Christmas Story/Christmas Story"}]}'
from public.categories c join public.boards b on b.id = c.board_id
where q.category_id = c.id and b.title = 'Sample board' and c.name = 'Christmas Movies' and q.value = 300;
