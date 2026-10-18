-- Allow one event to include multiple courses, year levels, and sections.
-- Empty arrays mean no restriction for that dimension.

create or replace function public.create_event_with_audience(
  p_event_code text,
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_course_ids uuid[] default '{}',
  p_year_level_ids uuid[] default '{}',
  p_section_ids uuid[] default '{}'
)
returns public.events language plpgsql security definer set search_path = public
as $$
declare
  result public.events;
  course_ids uuid[] := case when coalesce(array_length(p_course_ids, 1), 0) = 0 then array[null::uuid] else p_course_ids end;
  year_level_ids uuid[] := case when coalesce(array_length(p_year_level_ids, 1), 0) = 0 then array[null::uuid] else p_year_level_ids end;
  section_ids uuid[] := case when coalesce(array_length(p_section_ids, 1), 0) = 0 then array[null::uuid] else p_section_ids end;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  insert into public.events(event_code, title, start_time, end_time, created_by)
  values (btrim(p_event_code), btrim(p_title), p_start_time, p_end_time, auth.uid())
  returning * into result;

  if coalesce(array_length(p_section_ids, 1), 0) > 0 and exists (
    select 1
    from unnest(p_section_ids) selected_section
    where not exists (select 1 from public.academic_sections s where s.id = selected_section and s.is_active)
  ) then raise exception 'Invalid event section'; end if;

  insert into public.event_audience(event_id, course_id, year_level_id, section_id)
  select distinct result.id, selected_course, selected_year, selected_section
  from unnest(course_ids) selected_course
  cross join unnest(year_level_ids) selected_year
  cross join unnest(section_ids) selected_section
  where selected_course is not null or selected_year is not null or selected_section is not null;

  return result;
end;
$$;

revoke all on function public.create_event_with_audience(text,text,timestamptz,timestamptz,uuid[],uuid[],uuid[]) from public;
grant execute on function public.create_event_with_audience(text,text,timestamptz,timestamptz,uuid[],uuid[],uuid[]) to authenticated;
