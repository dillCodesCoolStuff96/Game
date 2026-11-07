-- Bonus games: a passed item goes to the back of the line, so the team can
-- try it again if they get through the rest. Otherwise unchanged from 010.

create or replace function public.bonus_mark(p_room_id uuid, p_correct boolean)
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
  set bonus = bonus || jsonb_build_object(
    'index', (bonus ->> 'index')::int + 1,
    'correct', (bonus ->> 'correct')::int + case when p_correct then 1 else 0 end,
    'order', case
      when p_correct then bonus -> 'order'
      else (bonus -> 'order') || jsonb_build_array((bonus -> 'order') -> ((bonus ->> 'index')::int))
    end
  )
  where id = p_room_id
    and bonus ->> 'status' = 'playing'
    and now() <= (bonus ->> 'ends_at')::timestamptz + interval '1 second'
    and (bonus ->> 'index')::int < jsonb_array_length(bonus -> 'order');
end;
$$;
