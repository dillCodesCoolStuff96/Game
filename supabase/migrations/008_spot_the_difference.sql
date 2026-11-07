-- Spot-the-difference questions: two images side by side, played as a normal
-- buzz-in question; the reveal circles each difference. Also adds image
-- storage for questions.

-- { left, right, spots: [{ x, y }] }: image URLs, and where each difference
-- is as a fraction of the image's width/height (0-1).
alter table public.questions add column spotdiff jsonb;

-- ---------- Image storage ----------

-- Public read, so the TV can show images by URL. Each host uploads into a
-- folder named after their user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images', 'question-images', true, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create policy "hosts upload question images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'question-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

create policy "hosts replace their question images" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "hosts delete their question images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Sample board example ----------
-- Turn one square on existing sample boards into a spot-the-difference
-- question (new sample boards get it from the app). The images ship with the app.

update public.questions q
set prompt = 'Spot the 4 differences!',
    answer = 'No moon, no star on the tree, a window light is off, the snowman''s hat is red',
    spotdiff = '{"left": "/samples/spot-a.svg", "right": "/samples/spot-b.svg", "spots": [
      {"x": 0.85, "y": 0.15}, {"x": 0.5875, "y": 0.233},
      {"x": 0.29, "y": 0.52}, {"x": 0.85, "y": 0.46}]}'
from public.categories c join public.boards b on b.id = c.board_id
where q.category_id = c.id and b.title = 'Sample board' and c.name = 'Food & Drink' and q.value = 400;
