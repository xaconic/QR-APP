-- Make event eligibility explicit. Existing events remain unrestricted; new
-- events must explicitly use All Students or configure one or more groups.

alter table public.events
  add column if not exists audience_mode text not null default 'all';
alter table public.events drop constraint if exists events_audience_mode_check;
alter table public.events add constraint events_audience_mode_check check (audience_mode in ('all', 'groups', 'legacy'));

update public.events e
set audience_mode = 'groups'
where exists (select 1 from public.event_audience a where a.event_id = e.id);
update public.events e
set audience_mode = 'legacy'
where not exists (select 1 from public.event_audience a where a.event_id = e.id)
  and e.audience_mode = 'all';

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
language plpgsql security definer set search_path = public
as $$
declare
  result public.events;
  has_groups boolean := coalesce(array_length(p_course_ids, 1), 0) > 0
    or coalesce(array_length(p_year_level_ids, 1), 0) > 0
    or coalesce(array_length(p_section_ids, 1), 0) > 0;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin') and is_active) then
    raise exception 'Not authorized to create events';
  end if;
  if p_end_time is not null and p_start_time is not null and p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;

  insert into public.events(event_code, title, start_time, end_time, created_by, audience_mode)
  values (btrim(p_event_code), btrim(p_title), p_start_time, p_end_time, auth.uid(), case when has_groups then 'groups' else 'all' end)
  returning * into result;

  if not has_groups then return result; end if;
  if coalesce(array_length(p_course_ids, 1), 0) = 0
    or coalesce(array_length(p_year_level_ids, 1), 0) = 0
    or coalesce(array_length(p_section_ids, 1), 0) = 0 then
    raise exception 'Select at least one complete eligible group';
  end if;

  if exists (select 1 from unnest(coalesce(p_course_ids, '{}')) selected_id where not exists (select 1 from public.courses c where c.id = selected_id and c.is_active)) then raise exception 'Invalid event course'; end if;
  if exists (select 1 from unnest(coalesce(p_year_level_ids, '{}')) selected_id where not exists (select 1 from public.year_levels y where y.id = selected_id and y.is_active)) then raise exception 'Invalid event year level'; end if;
  if exists (select 1 from unnest(coalesce(p_section_ids, '{}')) selected_id where not exists (select 1 from public.academic_sections s where s.id = selected_id and s.is_active)) then raise exception 'Invalid event section'; end if;

  insert into public.event_audience(event_id, course_id, year_level_id, section_id)
  select result.id, s.course_id, s.year_level_id, s.id
  from public.academic_sections s
  where s.id = any(p_section_ids)
    and s.course_id = any(p_course_ids)
    and s.year_level_id = any(p_year_level_ids)
    and s.is_active;
  return result;
end;
$$;

create or replace function public.update_event_audience(
  p_event_id uuid,
  p_audience_mode text,
  p_course_ids uuid[] default '{}',
  p_year_level_ids uuid[] default '{}',
  p_section_ids uuid[] default '{}'
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
begin
  if auth.uid() is null or not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  if p_audience_mode not in ('all', 'groups') then raise exception 'Invalid audience mode'; end if;
  if p_audience_mode = 'groups' and (coalesce(array_length(p_course_ids, 1), 0) = 0
    or coalesce(array_length(p_year_level_ids, 1), 0) = 0
    or coalesce(array_length(p_section_ids, 1), 0) = 0) then
    raise exception 'Select at least one complete eligible group';
  end if;

  if p_audience_mode = 'groups' then
    if exists (select 1 from unnest(coalesce(p_course_ids, '{}')) selected_id where not exists (select 1 from public.courses c where c.id = selected_id and c.is_active)) then raise exception 'Invalid event course'; end if;
    if exists (select 1 from unnest(coalesce(p_year_level_ids, '{}')) selected_id where not exists (select 1 from public.year_levels y where y.id = selected_id and y.is_active)) then raise exception 'Invalid event year level'; end if;
    if exists (select 1 from unnest(coalesce(p_section_ids, '{}')) selected_id where not exists (select 1 from public.academic_sections s where s.id = selected_id and s.is_active)) then raise exception 'Invalid event section'; end if;
  end if;

  delete from public.event_audience where event_id = p_event_id;
  update public.events set audience_mode = p_audience_mode where id = p_event_id;
  if p_audience_mode = 'all' then return; end if;

  insert into public.event_audience(event_id, course_id, year_level_id, section_id)
  select p_event_id, s.course_id, s.year_level_id, s.id
  from public.academic_sections s
  where s.id = any(p_section_ids)
    and s.course_id = any(p_course_ids)
    and s.year_level_id = any(p_year_level_ids)
    and s.is_active;
end;
$$;

create or replace function public.student_is_in_event_audience(p_event_id uuid, p_student_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select e.audience_mode = 'all'
    or exists (
      select 1 from public.event_audience a
      join public.profiles p on p.id = p_student_id
      where a.event_id = p_event_id
        and (a.course_id is null or a.course_id = p.course_id)
        and (a.year_level_id is null or a.year_level_id = p.year_level_id)
        and (a.section_id is null or a.section_id = p.section_id)
    )
  from public.events e where e.id = p_event_id;
$$;

create or replace function public.register_attendance(p_event_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target public.events;
  new_attendance public.attendance;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = current_user_id and role = 'student' and is_active) then raise exception 'Student is not eligible'; end if;
  select e.* into target from public.events e where e.event_code = trim(p_event_code)
  union all
  select e.* from public.events e join public.event_code_aliases a on a.event_id = e.id where a.event_code = trim(p_event_code)
  limit 1;
  if not found then raise exception 'Unknown event'; end if;
  if not public.student_is_in_event_audience(target.id, current_user_id) then raise exception 'You are not eligible for this event'; end if;
  if target.status <> 'open' then raise exception 'Event is closed'; end if;
  if target.start_time is not null and now() < target.start_time then raise exception 'Event has not started yet'; end if;
  if target.end_time is not null and now() > target.end_time then raise exception 'Event has already ended'; end if;
  begin
    insert into public.attendance (student_id, event_id) values (current_user_id, target.id) returning * into new_attendance;
  exception when unique_violation then raise exception 'Already registered for this event'; end;
  return jsonb_build_object('event_title', target.title, 'event_id', target.id, 'attendance_id', new_attendance.display_id);
end;
$$;

revoke all on function public.register_attendance(text) from public;
grant execute on function public.register_attendance(text) to authenticated;

revoke all on function public.update_event_audience(uuid, text, uuid[], uuid[], uuid[]) from public;
grant execute on function public.update_event_audience(uuid, text, uuid[], uuid[], uuid[]) to authenticated;
revoke all on function public.student_is_in_event_audience(uuid, uuid) from public;
grant execute on function public.student_is_in_event_audience(uuid, uuid) to authenticated;
