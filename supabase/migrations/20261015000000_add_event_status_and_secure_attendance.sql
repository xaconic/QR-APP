-- Add authoritative event status and database-side attendance registration.

alter table public.events add column if not exists status text;
update public.events set status = 'open' where status is null;
alter table public.events alter column status set default 'open';
alter table public.events alter column status set not null;
alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check check (status in ('open', 'closed'));

drop policy if exists "Users can update their own events" on public.events;
revoke update on public.events from authenticated;
drop policy if exists "Students can insert their own attendance" on public.attendance;
revoke insert on public.attendance from authenticated;

create or replace function public.set_event_status(p_event_id uuid, p_status text)
returns public.events
language plpgsql security definer set search_path = public
as $$
declare target public.events;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_status is null or p_status not in ('open', 'closed') then raise exception 'Status must be open or closed'; end if;
  select * into target from public.events where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if not (target.created_by = auth.uid() or public.is_admin()) then
    raise exception 'Not authorized to change this event';
  end if;
  update public.events set status = p_status where id = p_event_id returning * into target;
  return target;
end;
$$;

create or replace function public.register_attendance(p_event_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target public.events;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = current_user_id and role = 'student') then
    raise exception 'Student is not eligible';
  end if;
  select * into target from public.events where event_code = trim(p_event_code);
  if not found then raise exception 'Unknown event'; end if;
  if target.status <> 'open' then raise exception 'Event is closed'; end if;
  if target.start_time is not null and now() < target.start_time then raise exception 'Event has not started yet'; end if;
  if target.end_time is not null and now() > target.end_time then raise exception 'Event has already ended'; end if;
  begin
    insert into public.attendance (student_id, event_id) values (current_user_id, target.id);
  exception when unique_violation then
    raise exception 'Already registered for this event';
  end;
  return jsonb_build_object('event_title', target.title, 'event_id', target.id);
end;
$$;

revoke all on function public.set_event_status(uuid, text) from public;
grant execute on function public.set_event_status(uuid, text) to authenticated;
revoke all on function public.register_attendance(text) from public;
grant execute on function public.register_attendance(text) to authenticated;
