create table if not exists public.event_checkin_tokens (
  token uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists event_checkin_tokens_expiration_idx
  on public.event_checkin_tokens (expires_at);

alter table public.event_checkin_tokens enable row level security;
revoke all on table public.event_checkin_tokens from public, anon, authenticated;

create or replace function public.issue_event_checkin_token(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.events;
  issued_token uuid;
  token_expiration timestamptz;
begin
  if auth.uid() is null or not public.is_event_manager(p_event_id) then
    raise exception 'Not authorized for this event';
  end if;

  select * into target
  from public.events
  where id = p_event_id;

  if not found then
    raise exception 'Event not found';
  end if;
  if target.status <> 'open'
    or target.archived_at is not null
    or target.event_status = 'cancelled'
    or (target.end_time is not null and target.end_time < now()) then
    raise exception 'Event is closed';
  end if;

  delete from public.event_checkin_tokens
  where expires_at <= clock_timestamp();

  token_expiration := clock_timestamp() + interval '30 seconds';
  insert into public.event_checkin_tokens (event_id, expires_at)
  values (target.id, token_expiration)
  returning token into issued_token;

  return jsonb_build_object(
    'token', issued_token,
    'expires_at', token_expiration
  );
end;
$$;

revoke all on function public.issue_event_checkin_token(uuid) from public;
grant execute on function public.issue_event_checkin_token(uuid) to authenticated;

drop function if exists public.register_attendance(text);

create function public.register_attendance(p_event_code text, p_token uuid)
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
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = current_user_id and role = 'student' and is_active
  ) then
    raise exception 'Student is not eligible';
  end if;

  select e.* into target
  from public.events e
  where e.event_code = trim(p_event_code)
  union all
  select e.*
  from public.events e
  join public.event_code_aliases a on a.event_id = e.id
  where a.event_code = trim(p_event_code)
  limit 1;

  if not found then
    raise exception 'Unknown event';
  end if;
  if p_token is null or not exists (
    select 1
    from public.event_checkin_tokens t
    where t.token = p_token
      and t.event_id = target.id
      and t.expires_at > clock_timestamp()
  ) then
    raise exception 'Check-in code is invalid or expired';
  end if;
  if not public.student_is_in_event_audience(target.id, current_user_id) then
    raise exception 'You are not eligible for this event';
  end if;
  if target.end_time is not null and now() > target.end_time then
    perform public.finalize_event_attendance_internal(target.id);
    raise exception 'Event has already ended';
  end if;
  if target.status <> 'open' or target.archived_at is not null then
    raise exception 'Event is closed';
  end if;
  if target.start_time is not null and now() < target.start_time then
    raise exception 'Event has not started yet';
  end if;

  if target.late_time is not null and now() >= target.late_time then
    checkin_status := 'late';
  end if;

  begin
    insert into public.attendance (student_id, event_id, status, recorded_by, recorded_at)
    values (current_user_id, target.id, checkin_status, current_user_id, now())
    returning * into new_attendance;
  exception when unique_violation then
    raise exception 'Already registered for this event';
  end;

  return jsonb_build_object(
    'event_title', target.title,
    'event_id', target.id,
    'attendance_id', new_attendance.display_id,
    'status', checkin_status
  );
end;
$$;

revoke all on function public.register_attendance(text, uuid) from public;
grant execute on function public.register_attendance(text, uuid) to authenticated;
