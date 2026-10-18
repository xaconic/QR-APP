-- Let students see who created events they personally attended without exposing
-- the profiles table or other users' records.
create or replace function public.get_student_attendance_history()
returns table (
  attendance_id uuid,
  attendance_display_id text,
  status text,
  scanned_at timestamptz,
  event_code text,
  event_title text,
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
    e.event_code,
    e.title,
    e.venue,
    e.description,
    p.full_name,
    p.display_id
  from public.attendance a
  join public.events e on e.id = a.event_id
  left join public.profiles p on p.id = e.created_by
  where a.student_id = auth.uid()
  order by a.scanned_at desc;
$$;

revoke all on function public.get_student_attendance_history() from public;
grant execute on function public.get_student_attendance_history() to authenticated;
