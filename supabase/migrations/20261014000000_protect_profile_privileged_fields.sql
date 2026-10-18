-- Prevent authenticated clients from changing profile identity or privileges.
-- The existing registration flow may still assign student or teacher during signup.

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if new.id is distinct from old.id then
      raise exception 'Profile ID cannot be changed by an authenticated client';
    end if;

    if new.email is distinct from old.email then
      raise exception 'Profile email cannot be changed through profile updates';
    end if;

    if new.role = 'admin' and not public.is_admin() then
      raise exception 'Administrator role cannot be assigned by an authenticated client';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();
