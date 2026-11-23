-- AI-judged drawing questions. Each team draws the prompt on paper, uploads
-- a photo from a phone, and Claude (called from a server function with the
-- host's sign-in) scores every drawing. Best score wins the square's value;
-- ties split it. Reuses the all-play countdown and award functions.

-- ---------- Questions ----------

alter table public.questions drop constraint questions_kind_check;
alter table public.questions
  add constraint questions_kind_check check (kind in ('buzz', 'allplay', 'drawing'));

-- ---------- Drawings ----------

create table public.drawings (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  -- The room's buzz_round: one showing of a question.
  round int not null,
  team_id uuid not null references public.teams (id) on delete cascade,
  image_url text not null,
  uploaded_by uuid references auth.users (id) on delete set null,
  -- The judge's verdict (null until judged).
  score int check (score between 0 and 10),
  comment text,
  created_at timestamptz not null default now(),
  unique (room_id, round, team_id)
);

alter table public.drawings enable row level security;
revoke all on public.drawings from anon, authenticated;
grant select on public.drawings to authenticated;

-- Teams see their own drawing; the host sees everyone's.
create policy "host and own team see drawings" on public.drawings
  for select to authenticated
  using (public.is_room_host(room_id) or team_id = public.my_team(room_id));

alter publication supabase_realtime add table public.drawings;

-- ---------- Photo uploads from players' phones ----------

-- Players (guest accounts included) may upload into drawings/<their user id>/.
create policy "players upload drawing photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'question-images'
    and (storage.foldername(name))[1] = 'drawings'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------- Functions ----------

-- A team submits (or replaces) its drawing while the countdown runs.
create function public.submit_drawing(p_room_id uuid, p_image_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_round int;
begin
  v_team_id := public.allplay_open_team(p_room_id, array['drawing']);
  -- Only photos uploaded to this project's storage.
  if p_image_url not like '%/storage/v1/object/public/question-images/drawings/%' then
    raise exception 'Upload the photo first';
  end if;

  select r.buzz_round into v_round from public.rooms r where r.id = p_room_id;
  insert into public.drawings (room_id, round, team_id, image_url, uploaded_by)
  values (p_room_id, v_round, v_team_id, p_image_url, auth.uid())
  on conflict (room_id, round, team_id)
  do update set image_url = excluded.image_url, uploaded_by = excluded.uploaded_by,
    score = null, comment = null;
end;
$$;

-- Save the judge's scores: p_verdicts = [{ "id": drawing id, "score": 0-10, "comment": "..." }].
create function public.save_drawing_verdicts(p_room_id uuid, p_verdicts jsonb)
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
      comment = left(v ->> 'comment', 300)
  from jsonb_array_elements(p_verdicts) as v
  where d.id = (v ->> 'id')::bigint and d.room_id = p_room_id;

  update public.rooms
  set allplay = coalesce(allplay, '{}'::jsonb) || jsonb_build_object('judged', true)
  where id = p_room_id;
end;
$$;

revoke execute on function public.submit_drawing, public.save_drawing_verdicts from public, anon;
grant execute on function public.submit_drawing, public.save_drawing_verdicts to authenticated;

-- ---------- Sample board example ----------
-- Turn one square on existing sample boards into a drawing question.

update public.questions q
set kind = 'drawing',
    prompt = 'Draw Santa on summer vacation',
    answer = 'Judged by the AI',
    allplay = '{"seconds": 180}'
from public.categories c join public.boards b on b.id = c.board_id
where q.category_id = c.id and b.title = 'Sample board' and c.name = 'Christmas Movies' and q.value = 500;
