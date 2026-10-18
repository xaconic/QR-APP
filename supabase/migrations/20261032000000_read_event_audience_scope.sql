-- Read an event's audience through a protected function so authorized
-- attendance managers receive the exact event scope regardless of client RLS.

create or replace function public.get_event_audience_scope(p_event_id uuid)
returns table (course_id uuid, year_level_id uuid, section_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_manager(p_event_id) then
    raise exception 'Not authorized for this event';
  end if;

  return query
  select a.course_id, a.year_level_id, a.section_id
  from public.event_audience a
  where a.event_id = p_event_id;
end;
$$;

revoke all on function public.get_event_audience_scope(uuid) from public;
grant execute on function public.get_event_audience_scope(uuid) to authenticated;
