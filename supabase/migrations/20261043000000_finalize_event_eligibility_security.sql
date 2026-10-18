-- Finalize event management authorization and event-specific eligibility.
-- This migration is additive/idempotent and preserves existing UUIDs, events,
-- attendance rows, and event_audience relationships.

alter table public.events
  add column if not exists audience_mode text not null default 'legacy';
alter table public.events
  add column if not exists audience_configured_at timestamptz;
alter table public.events drop constraint if exists events_audience_mode_check;
alter table public.events
  add constraint events_audience_mode_check
  check (audience_mode in ('all', 'groups', 'legacy'));

update public.events e
set audience_mode = 'groups',
    audience_configured_at = coalesce(e.audience_configured_at, e.created_at)
where exists (select 1 from public.event_audience a where a.event_id = e.id);

update public.events e
set audience_mode = 'legacy'
where not exists (select 1 from public.event_audience a where a.event_id = e.id)
  and e.audience_mode = 'all'
  and e.audience_configured_at is null;

update public.events e
set audience_mode = 'legacy'
where e.audience_mode = 'groups'
  and (
    not exists (select 1 from public.event_audience a where a.event_id = e.id)
    or exists (
      select 1 from public.event_audience a
      where a.event_id = e.id
        and (a.course_id is null or a.year_level_id is null or a.section_id is null)
    )
  );

create or replace function public.is_event_manager(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (
      select 1
      from public.events e
      join public.profiles p on p.id = e.created_by
      where e.id = p_event_id
        and e.created_by = auth.uid()
        and p.role in ('teacher', 'admin')
        and p.is_active
    )
    or exists (
      select 1
      from public.event_staff s
      join public.profiles p on p.id = s.teacher_id
      where s.event_id = p_event_id
        and s.teacher_id = auth.uid()
        and s.can_manage
        and p.role = 'teacher'
        and p.is_active
    )
  );
$$;

revoke all on function public.is_event_manager(uuid) from public;
grant execute on function public.is_event_manager(uuid) to authenticated;

-- Read the exact saved groups through a protected RPC. This is used by the
-- client after create/edit to verify persistence without exposing the table
-- to unrestricted reads.
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
  selected_sections integer;
  matching_sections integer;
  has_groups boolean := coalesce(array_length(p_course_ids, 1), 0) > 0
    or coalesce(array_length(p_year_level_ids, 1), 0) > 0
    or coalesce(array_length(p_section_ids, 1), 0) > 0;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('teacher', 'admin') and is_active
  ) then raise exception 'Not authorized to create events'; end if;
  if p_event_code is null or btrim(p_event_code) = '' or length(p_event_code) > 40 or p_event_code !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid event code';
  end if;
  if p_title is null or btrim(p_title) = '' or length(p_title) > 120 then
    raise exception 'Event title is required';
  end if;
  if p_end_time is not null and p_start_time is not null and p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;
  if has_groups and (
    coalesce(array_length(p_course_ids, 1), 0) = 0
    or coalesce(array_length(p_year_level_ids, 1), 0) = 0
    or coalesce(array_length(p_section_ids, 1), 0) = 0
  ) then raise exception 'Select at least one complete eligible group'; end if;

  if has_groups then
    if exists (select 1 from unnest(p_course_ids) x where not exists (select 1 from public.courses c where c.id = x and c.is_active)) then raise exception 'Invalid event course'; end if;
    if exists (select 1 from unnest(p_year_level_ids) x where not exists (select 1 from public.year_levels y where y.id = x and y.is_active)) then raise exception 'Invalid event year level'; end if;
    if exists (select 1 from unnest(p_section_ids) x where not exists (select 1 from public.academic_sections s where s.id = x and s.is_active)) then raise exception 'Invalid event section'; end if;
    select count(distinct x) into selected_sections from unnest(p_section_ids) x;
    select count(*) into matching_sections
    from public.academic_sections s
    where s.id = any(p_section_ids)
      and s.course_id = any(p_course_ids)
      and s.year_level_id = any(p_year_level_ids)
      and s.is_active;
    if selected_sections <> matching_sections then raise exception 'Each selected section must match its selected course and year level'; end if;
  end if;

  insert into public.events(event_code, title, start_time, end_time, created_by, audience_mode, audience_configured_at)
  values (btrim(p_event_code), btrim(p_title), p_start_time, p_end_time, auth.uid(), case when has_groups then 'groups' else 'all' end, now())
  returning * into result;

  if has_groups then
    insert into public.event_audience(event_id, course_id, year_level_id, section_id)
    select result.id, s.course_id, s.year_level_id, s.id
    from public.academic_sections s
    where s.id = any(p_section_ids)
      and s.course_id = any(p_course_ids)
      and s.year_level_id = any(p_year_level_ids)
      and s.is_active;
  end if;
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
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_sections integer;
  matching_sections integer;
begin
  if auth.uid() is null or not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  if p_audience_mode not in ('all', 'groups') then raise exception 'Invalid audience mode'; end if;

  if p_audience_mode = 'groups' then
    if coalesce(array_length(p_course_ids, 1), 0) = 0
      or coalesce(array_length(p_year_level_ids, 1), 0) = 0
      or coalesce(array_length(p_section_ids, 1), 0) = 0 then
      raise exception 'Select at least one complete eligible group';
    end if;
    if exists (select 1 from unnest(p_course_ids) x where not exists (select 1 from public.courses c where c.id = x and c.is_active)) then raise exception 'Invalid event course'; end if;
    if exists (select 1 from unnest(p_year_level_ids) x where not exists (select 1 from public.year_levels y where y.id = x and y.is_active)) then raise exception 'Invalid event year level'; end if;
    if exists (select 1 from unnest(p_section_ids) x where not exists (select 1 from public.academic_sections s where s.id = x and s.is_active)) then raise exception 'Invalid event section'; end if;
    select count(distinct x) into selected_sections from unnest(p_section_ids) x;
    select count(*) into matching_sections
    from public.academic_sections s
    where s.id = any(p_section_ids)
      and s.course_id = any(p_course_ids)
      and s.year_level_id = any(p_year_level_ids)
      and s.is_active;
    if selected_sections <> matching_sections then raise exception 'Each selected section must match its selected course and year level'; end if;
  end if;

  delete from public.event_audience where event_id = p_event_id;
  update public.events set audience_mode = p_audience_mode, audience_configured_at = now() where id = p_event_id;
  if p_audience_mode = 'groups' then
    insert into public.event_audience(event_id, course_id, year_level_id, section_id)
    select p_event_id, s.course_id, s.year_level_id, s.id
    from public.academic_sections s
    where s.id = any(p_section_ids)
      and s.course_id = any(p_course_ids)
      and s.year_level_id = any(p_year_level_ids)
      and s.is_active;
  end if;
end;
$$;

create or replace function public.admin_repair_event_audience(
  p_event_id uuid,
  p_audience_mode text,
  p_course_ids uuid[] default '{}',
  p_year_level_ids uuid[] default '{}',
  p_section_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Not authorized'; end if;
  perform public.update_event_audience(p_event_id, p_audience_mode, p_course_ids, p_year_level_ids, p_section_ids);
end;
$$;

create or replace function public.create_event_with_audience_details(
  p_event_code text,
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz,
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
  if p_venue is not null and length(p_venue) > 160 then raise exception 'Venue is too long'; end if;
  if p_description is not null and length(p_description) > 2000 then raise exception 'Description is too long'; end if;
  result := public.create_event_with_audience(
    p_event_code, p_title, p_start_time, p_end_time,
    p_course_ids, p_year_level_ids, p_section_ids
  );
  update public.events
  set venue = nullif(btrim(p_venue), ''), description = nullif(btrim(p_description), '')
  where id = result.id
  returning * into result;
  return result;
end;
$$;

create or replace function public.student_is_in_event_audience(p_event_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    e.audience_mode = 'all'
    or (
      e.audience_mode = 'groups'
      and exists (
        select 1
        from public.event_audience a
        join public.profiles p on p.id = p_student_id
        where a.event_id = e.id
          and a.course_id = p.course_id
          and a.year_level_id = p.year_level_id
          and a.section_id = p.section_id
      )
    ), false
  )
  from public.events e
  where e.id = p_event_id;
$$;

create or replace function public.update_event(
  p_event_id uuid, p_event_code text, p_title text, p_start_time timestamptz,
  p_end_time timestamptz, p_venue text, p_description text, p_status text
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare current_event public.events; old_event_code text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_status is null or p_status not in ('open', 'closed') then raise exception 'Status must be open or closed'; end if;
  if p_event_code is null or btrim(p_event_code) = '' or length(p_event_code) > 40 or p_event_code !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid event code'; end if;
  if p_title is null or btrim(p_title) = '' or length(p_title) > 120 then raise exception 'Event title is required'; end if;
  if p_venue is not null and length(p_venue) > 160 then raise exception 'Venue is too long'; end if;
  if p_description is not null and length(p_description) > 2000 then raise exception 'Description is too long'; end if;
  if p_start_time is not null and p_end_time is not null and p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized to edit this event'; end if;
  select * into current_event from public.events where id = p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  old_event_code := current_event.event_code;
  if exists (select 1 from public.events where event_code = p_event_code and id <> p_event_id)
    or exists (select 1 from public.event_code_aliases where event_code = p_event_code and event_id <> p_event_id) then
    raise exception 'Event code already in use';
  end if;
  update public.events
  set event_code = p_event_code, title = btrim(p_title), start_time = p_start_time, end_time = p_end_time,
      venue = nullif(btrim(p_venue), ''), description = nullif(btrim(p_description), ''), status = p_status
  where id = p_event_id returning * into current_event;
  if old_event_code is distinct from p_event_code then
    insert into public.event_code_aliases(event_id, event_code) values (p_event_id, old_event_code)
    on conflict (event_code) do nothing;
  end if;
  return current_event;
end;
$$;

create or replace function public.set_event_status(p_event_id uuid, p_status text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare target public.events;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_status is null or p_status not in ('open', 'closed') then raise exception 'Status must be open or closed'; end if;
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized to change this event'; end if;
  update public.events set status = p_status where id = p_event_id returning * into target;
  if not found then raise exception 'Event not found'; end if;
  return target;
end;
$$;

create or replace function public.update_event_with_audience(
  p_event_id uuid,
  p_event_code text,
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz,
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
  -- Both calls run in this function's transaction. Any audience validation
  -- failure rolls back the event-field update as well.
  result := public.update_event(
    p_event_id, p_event_code, p_title, p_start_time, p_end_time,
    p_venue, p_description, p_status
  );
  perform public.update_event_audience(
    p_event_id, p_audience_mode, p_course_ids, p_year_level_ids, p_section_ids
  );
  select * into result from public.events where id = p_event_id;
  return result;
end;
$$;

create or replace function public.get_managed_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare result public.events;
begin
  if auth.uid() is null or not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  select * into result from public.events where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;
  return result;
end;
$$;

create or replace function public.register_attendance(p_event_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare current_user_id uuid := auth.uid(); target public.events; new_attendance public.attendance;
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
  if target.archived_at is not null then raise exception 'Event is closed'; end if;
  if target.start_time is not null and now() < target.start_time then raise exception 'Event has not started yet'; end if;
  if target.end_time is not null and now() > target.end_time then raise exception 'Event has already ended'; end if;
  begin
    insert into public.attendance(student_id, event_id) values (current_user_id, target.id) returning * into new_attendance;
  exception when unique_violation then raise exception 'Already registered for this event'; end;
  return jsonb_build_object('event_title', target.title, 'event_id', target.id, 'attendance_id', new_attendance.display_id);
end;
$$;

create or replace function public.record_event_attendance(p_event_id uuid, p_student_id uuid, p_status text)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare result public.attendance;
begin
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  if p_status not in ('present', 'absent', 'late', 'excused') then raise exception 'Invalid attendance status'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then raise exception 'Event not found'; end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student' and is_active) then raise exception 'Student not found'; end if;
  if not public.student_is_in_event_audience(p_event_id, p_student_id) then raise exception 'Student is not eligible for this event'; end if;
  insert into public.attendance(student_id, event_id, status, recorded_by, recorded_at)
  values (p_student_id, p_event_id, p_status, auth.uid(), now())
  on conflict (student_id, event_id) do update set status = excluded.status, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at
  returning * into result;
  return result;
end;
$$;

-- Use assignment history for reports so a later reassignment does not erase a
-- student's historical place in an event roster.
create or replace function public.student_is_in_event_roster(p_event_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    e.audience_mode = 'all'
    or (
      e.audience_mode = 'groups'
      and (
        exists (
          select 1 from public.event_audience a
          join public.profiles p on p.id = p_student_id
          where a.event_id = e.id
            and a.course_id = p.course_id
            and a.year_level_id = p.year_level_id
            and a.section_id = p.section_id
        )
        or exists (
          select 1 from public.event_audience a
          join public.student_academic_assignments h
            on h.student_id = p_student_id
           and h.course_id = a.course_id
           and h.year_level_id = a.year_level_id
           and h.section_id = a.section_id
          where a.event_id = e.id
            and h.assigned_at <= coalesce(e.start_time, e.created_at)
            and (h.ended_at is null or h.ended_at >= coalesce(e.start_time, e.created_at))
        )
      )
    ), false
  )
  from public.events e
  where e.id = p_event_id;
$$;

create or replace function public.clear_event_attendance(p_event_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  if not public.student_is_in_event_audience(p_event_id, p_student_id) then raise exception 'Student is not eligible for this event'; end if;
  delete from public.attendance where event_id = p_event_id and student_id = p_student_id;
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

create or replace function public.get_student_discovery_events()
returns table (
  id uuid,
  event_code text,
  title text,
  start_time timestamptz,
  end_time timestamptz,
  created_by uuid,
  created_at timestamptz,
  status text,
  event_status text,
  venue text,
  description text,
  archived_at timestamptz,
  audience_mode text,
  attended boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.event_code, e.title, e.start_time, e.end_time, e.created_by, e.created_at,
    e.status, e.event_status, e.venue, e.description, e.archived_at, e.audience_mode,
    exists (select 1 from public.attendance a where a.event_id = e.id and a.student_id = auth.uid())
  from public.events e
  where exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student' and p.is_active)
    and e.archived_at is null
    and public.student_is_in_event_audience(e.id, auth.uid())
  order by e.start_time asc nulls first;
$$;

drop policy if exists "Events are readable by any authenticated user" on public.events;
drop policy if exists "Administrators can view all events" on public.events;
drop policy if exists "Events are readable by eligible users" on public.events;
create policy "Events are readable by eligible users"
  on public.events for select to authenticated
  using (public.is_admin() or public.is_event_manager(id) or (archived_at is null and public.student_is_in_event_audience(id, auth.uid())));

revoke all on function public.update_event(uuid, text, text, timestamptz, timestamptz, text, text, text) from public;
grant execute on function public.update_event(uuid, text, text, timestamptz, timestamptz, text, text, text) to authenticated;
revoke all on function public.update_event_with_audience(uuid, text, text, timestamptz, timestamptz, text, text, text, text, uuid[], uuid[], uuid[]) from public;
grant execute on function public.update_event_with_audience(uuid, text, text, timestamptz, timestamptz, text, text, text, text, uuid[], uuid[], uuid[]) to authenticated;
revoke all on function public.set_event_status(uuid, text) from public;
grant execute on function public.set_event_status(uuid, text) to authenticated;
revoke all on function public.get_managed_event(uuid) from public;
grant execute on function public.get_managed_event(uuid) to authenticated;
revoke all on function public.get_event_audience_scope(uuid) from public;
grant execute on function public.get_event_audience_scope(uuid) to authenticated;
revoke all on function public.create_event_with_audience(text, text, timestamptz, timestamptz, uuid[], uuid[], uuid[]) from public;
grant execute on function public.create_event_with_audience(text, text, timestamptz, timestamptz, uuid[], uuid[], uuid[]) to authenticated;
revoke all on function public.create_event_with_audience_details(text, text, timestamptz, timestamptz, text, text, uuid[], uuid[], uuid[]) from public;
grant execute on function public.create_event_with_audience_details(text, text, timestamptz, timestamptz, text, text, uuid[], uuid[], uuid[]) to authenticated;
revoke all on function public.update_event_audience(uuid, text, uuid[], uuid[], uuid[]) from public;
grant execute on function public.update_event_audience(uuid, text, uuid[], uuid[], uuid[]) to authenticated;
revoke all on function public.admin_repair_event_audience(uuid, text, uuid[], uuid[], uuid[]) from public;
grant execute on function public.admin_repair_event_audience(uuid, text, uuid[], uuid[], uuid[]) to authenticated;
revoke all on function public.register_attendance(text) from public;
grant execute on function public.register_attendance(text) to authenticated;
revoke all on function public.record_event_attendance(uuid, uuid, text) from public;
grant execute on function public.record_event_attendance(uuid, uuid, text) to authenticated;
revoke all on function public.clear_event_attendance(uuid, uuid) from public;
grant execute on function public.clear_event_attendance(uuid, uuid) to authenticated;
revoke all on function public.student_is_in_event_roster(uuid, uuid) from public;
grant execute on function public.student_is_in_event_roster(uuid, uuid) to authenticated;
revoke all on function public.get_event_attendance_summary(uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.get_event_attendance_summary(uuid, uuid, uuid, uuid, text) to authenticated;
revoke all on function public.get_student_discovery_events() from public;
grant execute on function public.get_student_discovery_events() to authenticated;
