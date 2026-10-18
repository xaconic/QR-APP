create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
  target_is_active boolean;
  active_admins integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own administrator account';
  end if;

  select role, is_active
  into target_role, target_is_active
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User not found';
  end if;

  if target_role = 'admin' and target_is_active then
    select count(*)
    into active_admins
    from public.profiles
    where role = 'admin' and is_active;

    if active_admins <= 1 then
      raise exception 'The last active administrator cannot be deleted';
    end if;
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;
