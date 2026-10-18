-- Include each eligible student's academic group in attendance cards.

create or replace function public.get_event_attendance_summary(
  p_event_id uuid, p_course_id uuid default null, p_year_level_id uuid default null,
  p_section_id uuid default null, p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  select jsonb_build_object(
    'total', count(*),
    'present', count(*) filter (where a.status='present'),
    'absent', count(*) filter (where a.status='absent'),
    'late', count(*) filter (where a.status='late'),
    'excused', count(*) filter (where a.status='excused'),
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
  left join public.attendance a on a.student_id=p.id and a.event_id=p_event_id
  where p.role='student' and p.is_active
    and public.student_is_in_event_audience(p_event_id, p.id)
    and (p_course_id is null or p.course_id=p_course_id)
    and (p_year_level_id is null or p.year_level_id=p_year_level_id)
    and (p_section_id is null or p.section_id=p_section_id)
    and (p_status is null or a.status=p_status);
  return result;
end;
$$;

revoke all on function public.get_event_attendance_summary(uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.get_event_attendance_summary(uuid, uuid, uuid, uuid, text) to authenticated;
