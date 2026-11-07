-- Step 2: question boards and scoring.
-- Boards (categories + questions) belong to the host and are private to them,
-- so players can never read the answers. A room plays one board; correct
-- answers score the full value, wrong answers lose half.

-- ---------- Board content (host only) ----------

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  position int not null,
  name text not null
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  value int not null check (value > 0),
  prompt text not null,
  answer text not null,
  image_url text
);

create function public.owns_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.boards b where b.id = p_board_id and b.owner_id = auth.uid());
$$;

create function public.owns_category(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.categories c join public.boards b on b.id = c.board_id
    where c.id = p_category_id and b.owner_id = auth.uid()
  );
$$;

alter table public.boards enable row level security;
alter table public.categories enable row level security;
alter table public.questions enable row level security;

revoke all on public.boards, public.categories, public.questions from anon, authenticated;
grant select, insert, update, delete on public.boards, public.categories, public.questions to authenticated;

create policy "owner manages boards" on public.boards
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy "owner manages categories" on public.categories
  for all to authenticated
  using (public.owns_board(board_id))
  with check (public.owns_board(board_id));
create policy "owner manages questions" on public.questions
  for all to authenticated
  using (public.owns_category(category_id))
  with check (public.owns_category(category_id));

-- ---------- Live game state ----------

alter table public.rooms
  add column board_id uuid references public.boards (id) on delete set null,
  -- What the TV shows: the board, a question, or a question's answer.
  add column phase text not null default 'board' check (phase in ('board', 'question', 'answer')),
  add column current_question_id uuid references public.questions (id) on delete set null,
  -- Team that answered the last question right and picks the next one.
  add column picking_team_id uuid references public.teams (id) on delete set null;

grant update (board_id, phase, current_question_id, picking_team_id) on public.rooms to authenticated;

-- How the host judged each buzz (null = not judged yet).
alter table public.buzzes
  add column result text check (result in ('correct', 'wrong'));

-- Questions already played in a room (greyed out on the board).
create table public.played_questions (
  room_id uuid not null references public.rooms (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  primary key (room_id, question_id)
);

-- Every score change. Team scores are kept in sync by a trigger, so undoing
-- is just deleting the event.
create table public.score_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  question_id uuid references public.questions (id) on delete set null,
  buzz_id bigint references public.buzzes (id) on delete set null,
  points int not null,
  created_at timestamptz not null default now()
);

alter table public.played_questions enable row level security;
alter table public.score_events enable row level security;

revoke all on public.played_questions, public.score_events from anon, authenticated;
grant select, delete on public.played_questions to authenticated;
grant select on public.score_events to authenticated;

create policy "members see played questions" on public.played_questions
  for select to authenticated using (public.is_room_member(room_id));
create policy "host reopens questions" on public.played_questions
  for delete to authenticated using (public.is_room_host(room_id));
create policy "members see score events" on public.score_events
  for select to authenticated using (public.is_room_member(room_id));

-- Scores only change through score events now.
revoke update (score) on public.teams from authenticated;

create function public.apply_score_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.teams set score = score + new.points where id = new.team_id;
    return new;
  end if;
  update public.teams set score = score - old.points where id = old.team_id;
  return old;
end;
$$;

create trigger score_events_apply
  after insert or delete on public.score_events
  for each row execute function public.apply_score_event();

-- ---------- Functions the host's TV calls ----------

-- Rooms now start with a board.
drop function public.create_room();
create function public.create_room(p_board_id uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet text := 'BCDFGHJKLMNPQRSTVWXZ';
  v_code text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to host a game';
  end if;
  if p_board_id is not null and not public.owns_board(p_board_id) then
    raise exception 'Board not found';
  end if;

  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into public.rooms (code, host_id, board_id) values (v_code, auth.uid(), p_board_id);
      return v_code;
    exception when unique_violation then
      -- Code already used; try another.
    end;
  end loop;
end;
$$;

-- Show the answer and mark the current question as played.
create function public.finish_question(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id uuid;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;

  update public.rooms set phase = 'answer', buzz_open = false
  where id = p_room_id
  returning current_question_id into v_question_id;

  if v_question_id is not null then
    insert into public.played_questions (room_id, question_id)
    values (p_room_id, v_question_id)
    on conflict do nothing;
  end if;
end;
$$;

-- Mark a buzz right (+full value, that team picks next, show the answer)
-- or wrong (-half value; the next team in line gets a turn).
create function public.judge_answer(p_buzz_id bigint, p_correct boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buzz public.buzzes;
  v_question_id uuid;
  v_value int;
begin
  select * into v_buzz from public.buzzes where id = p_buzz_id;
  if v_buzz.id is null or not public.is_room_host(v_buzz.room_id) then
    raise exception 'Only the host can judge answers';
  end if;
  if v_buzz.result is not null then
    return; -- already judged (e.g. a double click)
  end if;

  select r.current_question_id, q.value into v_question_id, v_value
  from public.rooms r join public.questions q on q.id = r.current_question_id
  where r.id = v_buzz.room_id;
  if v_value is null then
    raise exception 'No question is showing';
  end if;

  update public.buzzes
  set result = case when p_correct then 'correct' else 'wrong' end
  where id = p_buzz_id;

  insert into public.score_events (room_id, team_id, question_id, buzz_id, points)
  values (
    v_buzz.room_id, v_buzz.team_id, v_question_id, p_buzz_id,
    case when p_correct then v_value else -(v_value / 2) end
  );

  if p_correct then
    update public.rooms set picking_team_id = v_buzz.team_id where id = v_buzz.room_id;
    perform public.finish_question(v_buzz.room_id);
  end if;
end;
$$;

-- Take back the most recent score change (for mis-clicks).
create function public.undo_last_score(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buzz_id bigint;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the host can do that';
  end if;

  delete from public.score_events
  where id = (select max(e.id) from public.score_events e where e.room_id = p_room_id)
  returning buzz_id into v_buzz_id;

  if v_buzz_id is not null then
    update public.buzzes set result = null where id = v_buzz_id;
  end if;
end;
$$;

revoke execute on function public.owns_board, public.owns_category, public.create_room,
  public.finish_question, public.judge_answer, public.undo_last_score from public, anon;
grant execute on function public.owns_board, public.owns_category, public.create_room,
  public.finish_question, public.judge_answer, public.undo_last_score to authenticated;

alter publication supabase_realtime add table public.played_questions;
