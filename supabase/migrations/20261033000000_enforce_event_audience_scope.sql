-- Persist the selected academic audience for every newly created event.
-- Empty arrays mean that dimension is unrestricted; all three empty means all students.

create or replace function public.create_event_with_audience(
  p_event_code text,
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_course_ids uuid[] default '{}',
  p_year_level_ids uuid[] default '{}',
  p_section_ids uuid[] default '{}'
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.events;
  selected_course uuid;
  selected_year uuid;
  selected_section uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('teacher', 'admin') and is_active
  ) then raise exception 'Not authorized to create events'; end if;
  if p_end_time is not null and p_start_time is not null and p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;

  insert into public.events(event_code, title, start_time, end_time, created_by)
  values (btrim(p_event_code), btrim(p_title), p_start_time, p_end_time, auth.uid())
  returning * into result;

  if coalesce(array_length(p_course_ids, 1), 0) = 0
     and coalesce(array_length(p_year_level_ids, 1), 0) = 0
     and coalesce(array_length(p_section_ids, 1), 0) = 0 then
    return result;
  end if;

  if exists (
    select 1 from unnest(coalesce(p_course_ids, '{}')) selected_id
    where not exists (select 1 from public.courses c where c.id = selected_id and c.is_active)
  ) then raise exception 'Invalid event course'; end if;
  if exists (
    select 1 from unnest(coalesce(p_year_level_ids, '{}')) selected_id
    where not exists (select 1 from public.year_levels y where y.id = selected_id and y.is_active)
  ) then raise exception 'Invalid event year level'; end if;
  if exists (
    select 1 from unnest(coalesce(p_section_ids, '{}')) selected_id
    where not exists (select 1 from public.academic_sections s where s.id = selected_id and s.is_active)
  ) then raise exception 'Invalid event section'; end if;

  for selected_course in
    select unnest(case when coalesce(array_length(p_course_ids, 1), 0) = 0 then array[null::uuid] else p_course_ids end)
  loop
    for selected_year in
      select unnest(case when coalesce(array_length(p_year_level_ids, 1), 0) = 0 then array[null::uuid] else p_year_level_ids end)
    loop
      for selected_section in
        select unnest(case when coalesce(array_length(p_section_ids, 1), 0) = 0 then array[null::uuid] else p_section_ids end)
      loop
        insert into public.event_audience(event_id, course_id, year_level_id, section_id)
        values (result.id, selected_course, selected_year, selected_section);
      end loop;
    end loop;
  end loop;

  return result;
end;
$$;

revoke all on function public.create_event_with_audience(text, text, timestamptz, timestamptz, uuid[], uuid[], uuid[]) from public;
grant execute on function public.create_event_with_audience(text, text, timestamptz, timestamptz, uuid[], uuid[], uuid[]) to authenticated;
