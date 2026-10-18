-- Editable event metadata and backwards-compatible QR event-code aliases.

alter table public.events add column if not exists venue text;
alter table public.events add column if not exists description text;

create table if not exists public.event_code_aliases (
  event_id uuid not null references public.events(id) on delete cascade,
  event_code text primary key,
  created_at timestamptz not null default now()
);

alter table public.event_code_aliases enable row level security;
revoke all on public.event_code_aliases from authenticated;

create or replace function public.prevent_event_code_alias_collision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'events' and exists (select 1 from public.event_code_aliases where event_code = new.event_code) then
    raise exception 'Event code already reserved by an alias';
  end if;
  if tg_table_name = 'event_code_aliases' and exists (select 1 from public.events where event_code = new.event_code) then
    raise exception 'Event code alias conflicts with current event code';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_event_code_alias_collision on public.events;
create trigger prevent_event_code_alias_collision before insert or update of event_code on public.events
for each row execute function public.prevent_event_code_alias_collision();
drop trigger if exists prevent_alias_current_code_collision on public.event_code_aliases;
create trigger prevent_alias_current_code_collision before insert or update of event_code on public.event_code_aliases
for each row execute function public.prevent_event_code_alias_collision();

create or replace function public.update_event(
  p_event_id uuid,
  p_event_code text,
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_venue text,
  p_description text,
  p_status text
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  current_event public.events;
  old_event_code text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_event_id is null then raise exception 'Event not found'; end if;
  if p_status is null or p_status not in ('open', 'closed') then raise exception 'Status must be open or closed'; end if;
  if p_event_code is null or btrim(p_event_code) = '' then raise exception 'Event code is required'; end if;
  if length(p_event_code) > 40 or p_event_code !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid event code'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'Event title is required'; end if;
  if length(p_title) > 120 then raise exception 'Event title is too long'; end if;
  if p_venue is not null and length(p_venue) > 160 then raise exception 'Venue is too long'; end if;
  if p_description is not null and length(p_description) > 2000 then raise exception 'Description is too long'; end if;
  if p_start_time is not null and p_end_time is not null and p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;

  select * into current_event from public.events where id = p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if not (current_event.created_by = auth.uid() or public.is_admin()) then raise exception 'Not authorized to edit this event'; end if;
  old_event_code := current_event.event_code;

  if exists (select 1 from public.events where event_code = p_event_code and id <> p_event_id)
     or exists (select 1 from public.event_code_aliases where event_code = p_event_code and event_id <> p_event_id) then
    raise exception 'Event code already in use';
  end if;

  if old_event_code is distinct from p_event_code then
    if exists (select 1 from public.event_code_aliases where event_code = old_event_code) then
      raise exception 'Event code alias conflict';
    end if;
  end if;

  update public.events
  set event_code = p_event_code,
      title = btrim(p_title),
      start_time = p_start_time,
      end_time = p_end_time,
      venue = nullif(btrim(p_venue), ''),
      description = nullif(btrim(p_description), ''),
      status = p_status
  where id = p_event_id
  returning * into current_event;
  if old_event_code is distinct from p_event_code then
    insert into public.event_code_aliases (event_id, event_code) values (p_event_id, old_event_code);
  end if;
  return current_event;
exception when unique_violation then
  raise exception 'Event code already in use';
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
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = current_user_id and role = 'student') then raise exception 'Student is not eligible'; end if;
  select e.* into target from public.events e where e.event_code = trim(p_event_code)
  union all
  select e.* from public.events e join public.event_code_aliases a on a.event_id = e.id where a.event_code = trim(p_event_code)
  limit 1;
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

revoke all on function public.update_event(uuid, text, text, timestamptz, timestamptz, text, text, text) from public;
grant execute on function public.update_event(uuid, text, text, timestamptz, timestamptz, text, text, text) to authenticated;
revoke update on public.events from authenticated;
