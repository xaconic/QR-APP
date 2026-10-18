-- Finalize event eligibility semantics.
-- Explicit All Students is represented by audience_mode = 'all'.
-- Missing/ambiguous historical configuration is represented by 'legacy' and
-- must be repaired from Edit Event; it is never treated as unrestricted.

alter table public.events
  add column if not exists audience_configured_at timestamptz;

-- Recover restricted events whose group rows already exist.
update public.events e
set audience_mode = 'groups',
    audience_configured_at = coalesce(e.audience_configured_at, e.created_at)
where exists (select 1 from public.event_audience a where a.event_id = e.id);

-- The previous migration marked every row without groups as All Students.
-- Those rows are ambiguous, so require explicit administrator/owner repair.
update public.events e
set audience_mode = 'legacy'
where not exists (select 1 from public.event_audience a where a.event_id = e.id)
  and e.audience_mode = 'all'
  and e.audience_configured_at is null;

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
  selected_sections integer;
  inserted_sections integer;
  has_groups boolean := coalesce(array_length(p_course_ids, 1), 0) > 0
    or coalesce(array_length(p_year_level_ids, 1), 0) > 0
    or coalesce(array_length(p_section_ids, 1), 0) > 0;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin') and is_active) then
    raise exception 'Not authorized to create events';
  end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'Event title is required'; end if;
  if p_event_code is null or btrim(p_event_code) = '' then raise exception 'Event code is required'; end if;
  if p_end_time is not null and p_start_time is not null and p_end_time <= p_start_time then
    raise exception 'End time must be after start time';
  end if;
  if has_groups and (
    coalesce(array_length(p_course_ids, 1), 0) = 0 or
    coalesce(array_length(p_year_level_ids, 1), 0) = 0 or
    coalesce(array_length(p_section_ids, 1), 0) = 0
  ) then raise exception 'Select at least one complete eligible group'; end if;

  if has_groups then
    if exists (select 1 from unnest(p_course_ids) x where not exists (select 1 from public.courses c where c.id = x and c.is_active)) then raise exception 'Invalid event course'; end if;
    if exists (select 1 from unnest(p_year_level_ids) x where not exists (select 1 from public.year_levels y where y.id = x and y.is_active)) then raise exception 'Invalid event year level'; end if;
    if exists (select 1 from unnest(p_section_ids) x where not exists (select 1 from public.academic_sections s where s.id = x and s.is_active)) then raise exception 'Invalid event section'; end if;
    select count(distinct x) into selected_sections from unnest(p_section_ids) x;
    select count(*) into inserted_sections
    from public.academic_sections s
    where s.id = any(p_section_ids)
      and s.course_id = any(p_course_ids)
      and s.year_level_id = any(p_year_level_ids)
      and s.is_active;
    if selected_sections <> inserted_sections then raise exception 'Each selected section must match its selected course and year level'; end if;
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
language plpgsql security definer set search_path = public
as $$
declare
  selected_sections integer;
  inserted_sections integer;
begin
  if auth.uid() is null or not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  if p_audience_mode not in ('all', 'groups') then raise exception 'Invalid audience mode'; end if;
  if p_audience_mode = 'groups' and (
    coalesce(array_length(p_course_ids, 1), 0) = 0 or
    coalesce(array_length(p_year_level_ids, 1), 0) = 0 or
    coalesce(array_length(p_section_ids, 1), 0) = 0
  ) then raise exception 'Select at least one complete eligible group'; end if;

  if p_audience_mode = 'groups' then
    select count(distinct x) into selected_sections from unnest(p_section_ids) x;
    select count(*) into inserted_sections
    from public.academic_sections s
    where s.id = any(p_section_ids)
      and s.course_id = any(p_course_ids)
      and s.year_level_id = any(p_year_level_ids)
      and s.is_active;
    if selected_sections <> inserted_sections then raise exception 'Each selected section must match its selected course and year level'; end if;
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

-- Only administrators may explicitly repair an ambiguous legacy event.
create or replace function public.admin_repair_event_audience(
  p_event_id uuid,
  p_audience_mode text,
  p_course_ids uuid[] default '{}',
  p_year_level_ids uuid[] default '{}',
  p_section_ids uuid[] default '{}'
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Not authorized'; end if;
  perform public.update_event_audience(p_event_id, p_audience_mode, p_course_ids, p_year_level_ids, p_section_ids);
end;
$$;

revoke all on function public.admin_repair_event_audience(uuid, text, uuid[], uuid[], uuid[]) from public;
grant execute on function public.admin_repair_event_audience(uuid, text, uuid[], uuid[], uuid[]) to authenticated;

-- A selected group is always a complete course + year level + section match.
-- Nulls are not treated as wildcards for restricted events.
create or replace function public.student_is_in_event_audience(p_event_id uuid, p_student_id uuid)
returns boolean
language sql stable security definer set search_path = public
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

revoke all on function public.student_is_in_event_audience(uuid, uuid) from public;
grant execute on function public.student_is_in_event_audience(uuid, uuid) to authenticated;
