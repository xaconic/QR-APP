create or replace function public.get_event_attendance_export(
  p_event_id uuid,
  p_offset integer default 0,
  p_limit integer default 500,
  p_course_id uuid default null,
  p_year_level_id uuid default null,
  p_section_id uuid default null,
  p_status text default null,
  p_from_date date default null,
  p_to_date date default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_event_manager(p_event_id) then
    raise exception 'Not authorized for this event';
  end if;
  if p_offset is null or p_limit is null or p_offset < 0 or p_limit < 1 or p_limit > 500 then
    raise exception 'Invalid attendance export page';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'Start date must be on or before end date';
  end if;
  if p_status is not null and p_status not in ('present', 'absent', 'late', 'excused') then
    raise exception 'Invalid attendance status';
  end if;

  return (
    with filtered as materialized (
      select
        a.id as attendance_id,
        a.student_id,
        p.display_id as student_number,
        p.full_name,
        p.email,
        p.role,
        e.title as event_name,
        (e.start_time at time zone 'Asia/Manila')::date as event_date,
        a.status,
        case when a.status in ('present', 'late') then a.scanned_at end as scanned_at,
        a.recorded_at
      from public.attendance a
      join public.profiles p on p.id = a.student_id
      join public.events e on e.id = a.event_id
      where a.event_id = p_event_id
        and p.role = 'student'
        and p.is_active
        and public.student_is_in_event_roster(p_event_id, p.id)
        and (p_course_id is null or p.course_id = p_course_id)
        and (p_year_level_id is null or p.year_level_id = p_year_level_id)
        and (p_section_id is null or p.section_id = p_section_id)
        and (p_status is null or a.status = p_status)
        and (p_from_date is null or (a.recorded_at at time zone 'Asia/Manila')::date >= p_from_date)
        and (p_to_date is null or (a.recorded_at at time zone 'Asia/Manila')::date <= p_to_date)
        and (
          nullif(btrim(p_search), '') is null
          or concat_ws(' ', p.display_id, p.full_name, p.email) ilike '%' || btrim(p_search) || '%'
        )
    ),
    page as (
      select *
      from filtered
      order by scanned_at, attendance_id
      offset p_offset
      limit p_limit
    )
    select jsonb_build_object(
      'total_count', (select count(*) from filtered),
      'records', coalesce(
        (select jsonb_agg(to_jsonb(page) order by page.scanned_at, page.attendance_id) from page),
        '[]'::jsonb
      )
    )
  );
end;
$$;

revoke all on function public.get_event_attendance_export(uuid, integer, integer, uuid, uuid, uuid, text, date, date, text) from public;
grant execute on function public.get_event_attendance_export(uuid, integer, integer, uuid, uuid, uuid, text, date, date, text) to authenticated;
