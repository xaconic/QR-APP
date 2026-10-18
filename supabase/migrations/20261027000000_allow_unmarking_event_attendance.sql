-- Allow an authorized event manager to clear a student's attendance status.

create or replace function public.clear_event_attendance(p_event_id uuid, p_student_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  if not public.student_is_in_event_audience(p_event_id, p_student_id) then raise exception 'Student is not eligible for this event'; end if;
  delete from public.attendance where event_id = p_event_id and student_id = p_student_id;
end;
$$;

revoke all on function public.clear_event_attendance(uuid,uuid) from public;
grant execute on function public.clear_event_attendance(uuid,uuid) to authenticated;
