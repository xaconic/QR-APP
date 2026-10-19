drop function if exists public.get_student_attendance_history();

create function public.get_student_attendance_history()
returns table (
  attendance_id uuid,
  attendance_display_id text,
  status text,
  scanned_at timestamptz,
  recorded_at timestamptz,
  attendance_finalized boolean,
  event_id uuid,
  event_code text,
  event_title text,
  event_start_time timestamptz,
  late_time timestamptz,
  venue text,
  description text,
  creator_name text,
  creator_display_id text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id,
    a.display_id,
    a.status,
    a.scanned_at,
    a.recorded_at,
    e.event_status = 'completed',
    e.id,
    e.event_code,
    e.title,
    e.start_time,
    e.late_time,
    e.venue,
    e.description,
    p.full_name,
    p.display_id
  from public.attendance a
  join public.events e on e.id = a.event_id
  left join public.profiles p on p.id = e.created_by
  where a.student_id = auth.uid()
    and exists (
      select 1 from public.profiles student
      where student.id = auth.uid()
        and student.role = 'student'
        and student.is_active
    )
  order by a.scanned_at desc;
$$;

revoke all on function public.get_student_attendance_history() from public;
grant execute on function public.get_student_attendance_history() to authenticated;
