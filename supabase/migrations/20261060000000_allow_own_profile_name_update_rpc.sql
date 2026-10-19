create or replace function public.update_own_profile_name(p_full_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required to update a profile name';
  end if;

  update public.profiles
  set full_name = nullif(btrim(coalesce(p_full_name, '')), '')
  where id = current_user_id
    and is_active;

  if not found then
    raise exception 'Profile could not be updated. The account may be inactive.';
  end if;

  return true;
end;
$$;

revoke all on function public.update_own_profile_name(text) from public, anon;
grant execute on function public.update_own_profile_name(text) to authenticated;
