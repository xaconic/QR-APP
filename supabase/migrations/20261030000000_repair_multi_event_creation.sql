-- Repair the event creation RPC when the multi-audience migration was not
-- refreshed in Supabase's API schema cache.

create table if not exists public.event_audience (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  course_id uuid references public.courses(id) on delete restrict,
  year_level_id uuid references public.year_levels(id) on delete restrict,
  section_id uuid references public.academic_sections(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (course_id is not null or year_level_id is not null or section_id is not null)
);

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
declare result public.events; selected_course uuid; selected_year uuid; selected_section uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  insert into public.events(event_code, title, start_time, end_time, created_by)
  values (btrim(p_event_code), btrim(p_title), p_start_time, p_end_time, auth.uid())
  returning * into result;

  if coalesce(array_length(p_course_ids, 1), 0) = 0
    and coalesce(array_length(p_year_level_ids, 1), 0) = 0
    and coalesce(array_length(p_section_ids, 1), 0) = 0 then
    return result;
  end if;

  for selected_course in select unnest(case when coalesce(array_length(p_course_ids, 1), 0) = 0 then array[null::uuid] else p_course_ids end)
  loop
    for selected_year in select unnest(case when coalesce(array_length(p_year_level_ids, 1), 0) = 0 then array[null::uuid] else p_year_level_ids end)
    loop
      for selected_section in select unnest(case when coalesce(array_length(p_section_ids, 1), 0) = 0 then array[null::uuid] else p_section_ids end)
      loop
        insert into public.event_audience(event_id, course_id, year_level_id, section_id)
        values (result.id, selected_course, selected_year, selected_section);
      end loop;
    end loop;
  end loop;
  return result;
end;
$$;

revoke all on function public.create_event_with_audience(text,text,timestamptz,timestamptz,uuid[],uuid[],uuid[]) from public;
grant execute on function public.create_event_with_audience(text,text,timestamptz,timestamptz,uuid[],uuid[],uuid[]) to authenticated;
