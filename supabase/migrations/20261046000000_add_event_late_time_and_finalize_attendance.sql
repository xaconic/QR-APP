-- Add an event-specific late threshold and finalize ended events without
-- changing existing event IDs, attendance IDs, or saved audience groups.

alter table public.events
  add column if not exists late_time timestamptz;

create or replace function public.finalize_event_attendance_internal(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.events;
  inserted_count integer := 0;
begin
  select * into event_row from public.events where id = p_event_id for update;
  if not found or event_row.end_time is null or event_row.end_time > now()
     or event_row.event_status = 'cancelled' then
    return 0;
  end if;

  insert into public.attendance (student_id, event_id, status, recorded_by, recorded_at, scanned_at)
  select p.id, event_row.id, 'absent', null, now(), event_row.end_time
  from public.profiles p
  where p.role = 'student'
    and p.is_active
    and public.student_is_in_event_roster(event_row.id, p.id)
    and not exists (
      select 1 from public.attendance a
      where a.event_id = event_row.id and a.student_id = p.id
    );

  get diagnostics inserted_count = row_count;

  update public.events
  set status = 'closed',
      event_status = case when event_status <> 'cancelled' then 'completed' else event_status end
  where id = event_row.id;

  return inserted_count;
end;
$$;

create or replace function public.finalize_event_attendance(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_manager(p_event_id) then
    raise exception 'Not authorized for this event';
  end if;
  return public.finalize_event_attendance_internal(p_event_id);
end;
$$;

create or replace function public.create_event_with_audience_late_details(
  p_event_code text,
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_late_time timestamptz,
  p_venue text default null,
  p_description text default null,
  p_course_ids uuid[] default '{}',
  p_year_level_ids uuid[] default '{}',
  p_section_ids uuid[] default '{}'
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare result public.events;
begin
  if p_late_time is not null and p_start_time is null then
    raise exception 'Late time requires a start time';
  end if;
  if p_late_time is not null and p_late_time < p_start_time then
    raise exception 'Late time must be at or after the start time';
  end if;
  if p_late_time is not null and p_end_time is not null and p_late_time > p_end_time then
    raise exception 'Late time must be before the end time';
  end if;

  result := public.create_event_with_audience_details(
    p_event_code, p_title, p_start_time, p_end_time,
    p_venue, p_description, p_course_ids, p_year_level_ids, p_section_ids
  );
  update public.events set late_time = p_late_time where id = result.id returning * into result;
  return result;
end;
$$;

create or replace function public.update_event_with_audience_late(
  p_event_id uuid,
  p_event_code text,
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_late_time timestamptz,
  p_venue text,
  p_description text,
  p_status text,
  p_audience_mode text,
  p_course_ids uuid[] default '{}',
  p_year_level_ids uuid[] default '{}',
  p_section_ids uuid[] default '{}'
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare result public.events;
begin
  if p_late_time is not null and p_start_time is null then
    raise exception 'Late time requires a start time';
  end if;
  if p_late_time is not null and p_late_time < p_start_time then
    raise exception 'Late time must be at or after the start time';
  end if;
  if p_late_time is not null and p_end_time is not null and p_late_time > p_end_time then
    raise exception 'Late time must be before the end time';
  end if;

  result := public.update_event_with_audience(
    p_event_id, p_event_code, p_title, p_start_time, p_end_time,
    p_venue, p_description, p_status, p_audience_mode,
    p_course_ids, p_year_level_ids, p_section_ids
  );
  update public.events set late_time = p_late_time where id = p_event_id returning * into result;
  return result;
end;
$$;

create or replace function public.register_attendance(p_event_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target public.events;
  new_attendance public.attendance;
  checkin_status text := 'present';
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = current_user_id and role = 'student' and is_active) then
    raise exception 'Student is not eligible';
  end if;
  select e.* into target from public.events e where e.event_code = trim(p_event_code)
  union all
  select e.* from public.events e join public.event_code_aliases a on a.event_id = e.id where a.event_code = trim(p_event_code)
  limit 1;
  if not found then raise exception 'Unknown event'; end if;
  if not public.student_is_in_event_audience(target.id, current_user_id) then raise exception 'You are not eligible for this event'; end if;
  if target.end_time is not null and now() > target.end_time then
    perform public.finalize_event_attendance_internal(target.id);
    raise exception 'Event has already ended';
  end if;
  if target.status <> 'open' then raise exception 'Event is closed'; end if;
  if target.archived_at is not null then raise exception 'Event is closed'; end if;
  if target.start_time is not null and now() < target.start_time then raise exception 'Event has not started yet'; end if;
  if target.late_time is not null and now() >= target.late_time then checkin_status := 'late'; end if;
  begin
    insert into public.attendance(student_id, event_id, status, recorded_by, recorded_at)
    values (current_user_id, target.id, checkin_status, current_user_id, now())
    returning * into new_attendance;
  exception when unique_violation then raise exception 'Already registered for this event'; end;
  return jsonb_build_object('event_title', target.title, 'event_id', target.id, 'attendance_id', new_attendance.display_id, 'status', checkin_status);
end;
$$;

create or replace function public.get_event_attendance_summary(
  p_event_id uuid,
  p_course_id uuid default null,
  p_year_level_id uuid default null,
  p_section_id uuid default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  perform public.finalize_event_attendance_internal(p_event_id);
  if p_status is not null and p_status not in ('present', 'absent', 'late', 'excused') then raise exception 'Invalid attendance status'; end if;
  select jsonb_build_object(
    'total', count(*),
    'present', count(*) filter (where a.status = 'present'),
    'absent', count(*) filter (where a.status = 'absent'),
    'late', count(*) filter (where a.status = 'late'),
    'excused', count(*) filter (where a.status = 'excused'),
    'unmarked', count(*) filter (where a.id is null),
    'students', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'display_id', p.display_id, 'full_name', p.full_name, 'email', p.email,
      'course_id', p.course_id, 'course_code', c.code,
      'year_level_id', p.year_level_id, 'year_level_name', y.name,
      'section_id', p.section_id, 'section_name', s.section_name, 'section_code', s.section_code,
      'attendance_id', a.display_id, 'status', a.status, 'recorded_at', a.recorded_at
    ) order by p.full_name), '[]'::jsonb)
  ) into result
  from public.profiles p
  left join public.courses c on c.id = p.course_id
  left join public.year_levels y on y.id = p.year_level_id
  left join public.academic_sections s on s.id = p.section_id
  left join public.attendance a on a.student_id = p.id and a.event_id = p_event_id
  where p.role = 'student' and p.is_active
    and public.student_is_in_event_roster(p_event_id, p.id)
    and (p_course_id is null or p.course_id = p_course_id)
    and (p_year_level_id is null or p.year_level_id = p_year_level_id)
    and (p_section_id is null or p.section_id = p_section_id)
    and (p_status is null or a.status = p_status);
  return result;
end;
$$;

revoke all on function public.finalize_event_attendance(uuid) from public;
grant execute on function public.finalize_event_attendance(uuid) to authenticated;
revoke all on function public.create_event_with_audience_late_details(text, text, timestamptz, timestamptz, timestamptz, text, text, uuid[], uuid[], uuid[]) from public;
grant execute on function public.create_event_with_audience_late_details(text, text, timestamptz, timestamptz, timestamptz, text, text, uuid[], uuid[], uuid[]) to authenticated;
revoke all on function public.update_event_with_audience_late(uuid, text, text, timestamptz, timestamptz, timestamptz, text, text, text, text, uuid[], uuid[], uuid[]) from public;
grant execute on function public.update_event_with_audience_late(uuid, text, text, timestamptz, timestamptz, timestamptz, text, text, text, text, uuid[], uuid[], uuid[]) to authenticated;
revoke all on function public.register_attendance(text) from public;
grant execute on function public.register_attendance(text) to authenticated;
revoke all on function public.get_event_attendance_summary(uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.get_event_attendance_summary(uuid, uuid, uuid, uuid, text) to authenticated;
