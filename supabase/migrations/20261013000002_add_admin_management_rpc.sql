-- Secure administrator management with reversible deactivation and event archiving.

alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists deactivated_at timestamptz;
alter table public.events add column if not exists archived_at timestamptz;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active); $$;

drop policy if exists "Users can insert events" on public.events;
create policy "Teachers and administrators can insert events" on public.events for insert to authenticated
with check (
  auth.uid() = created_by
  and exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin') and is_active)
);

create or replace function public.admin_update_profile(p_user_id uuid, p_full_name text)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare target public.profiles;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_full_name is not null and length(btrim(p_full_name)) > 120 then raise exception 'Name is too long'; end if;
  update public.profiles set full_name = nullif(btrim(p_full_name), ''), updated_at = now() where id = p_user_id returning * into target;
  if not found then raise exception 'User not found'; end if;
  return target;
end;
$$;

create or replace function public.admin_deactivate_user(p_user_id uuid)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare target public.profiles; active_admins integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot deactivate your own administrator account'; end if;
  select * into target from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if target.role = 'admin' and target.is_active then
    select count(*) into active_admins from public.profiles where role = 'admin' and is_active;
    if active_admins <= 1 then raise exception 'The last active administrator cannot be deactivated'; end if;
  end if;
  update public.profiles set is_active = false, deactivated_at = now(), updated_at = now() where id = p_user_id returning * into target;
  return target;
end;
$$;

create or replace function public.admin_archive_event(p_event_id uuid)
returns public.events
language plpgsql security definer set search_path = public
as $$
declare target public.events;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.events set archived_at = coalesce(archived_at, now()), status = 'closed' where id = p_event_id returning * into target;
  if not found then raise exception 'Event not found'; end if;
  return target;
end;
$$;

revoke all on function public.admin_update_profile(uuid, text) from public;
grant execute on function public.admin_update_profile(uuid, text) to authenticated;
revoke all on function public.admin_deactivate_user(uuid) from public;
grant execute on function public.admin_deactivate_user(uuid) to authenticated;
revoke all on function public.admin_archive_event(uuid) from public;
grant execute on function public.admin_archive_event(uuid) to authenticated;
