-- Repair migration for databases where the unmarking migration was applied
-- before the event-audience migration.

create table if not exists public.event_audience (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  course_id uuid references public.courses(id) on delete restrict,
  year_level_id uuid references public.year_levels(id) on delete restrict,
  section_id uuid references public.academic_sections(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (course_id is not null or year_level_id is not null or section_id is not null)
);

alter table public.event_audience enable row level security;

create or replace function public.student_is_in_event_audience(p_event_id uuid, p_student_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select not exists (select 1 from public.event_audience where event_id = p_event_id)
    or exists (
      select 1
      from public.event_audience a
      join public.profiles p on p.id = p_student_id
      where a.event_id = p_event_id
        and (a.course_id is null or a.course_id = p.course_id)
        and (a.year_level_id is null or a.year_level_id = p.year_level_id)
        and (a.section_id is null or a.section_id = p.section_id)
    );
$$;

create or replace function public.clear_event_attendance(p_event_id uuid, p_student_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  if not public.student_is_in_event_audience(p_event_id, p_student_id) then raise exception 'Student is not eligible for this event'; end if;
  delete from public.attendance where event_id = p_event_id and student_id = p_student_id;
end;
$$;

revoke all on function public.student_is_in_event_audience(uuid,uuid) from public;
grant execute on function public.student_is_in_event_audience(uuid,uuid) to authenticated;
revoke all on function public.clear_event_attendance(uuid,uuid) from public;
grant execute on function public.clear_event_attendance(uuid,uuid) to authenticated;
