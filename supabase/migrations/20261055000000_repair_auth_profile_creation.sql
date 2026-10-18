create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text := new.raw_app_meta_data ->> 'role';
  academic_level text := new.raw_user_meta_data ->> 'academic_level_id';
  course text := new.raw_user_meta_data ->> 'course_id';
  year_level text := new.raw_user_meta_data ->> 'year_level_id';
  section text := new.raw_user_meta_data ->> 'section_id';
begin
  if assigned_role is null or assigned_role not in ('student', 'teacher', 'admin') then
    assigned_role := 'student';
  end if;

  if assigned_role = 'student' and (
    nullif(academic_level, '') is null
    or nullif(course, '') is null
    or nullif(year_level, '') is null
    or nullif(section, '') is null
  ) then
    raise exception 'Student academic information is required';
  end if;

  insert into public.profiles (
    id, email, full_name, role, academic_level_id, course_id, year_level_id, section_id
  )
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    assigned_role,
    case when assigned_role = 'student' then nullif(academic_level, '')::uuid end,
    case when assigned_role = 'student' then nullif(course, '')::uuid end,
    case when assigned_role = 'student' then nullif(year_level, '')::uuid end,
    case when assigned_role = 'student' then nullif(section, '')::uuid end
  )
  on conflict (id) do nothing;

  if assigned_role = 'student' then
    insert into public.student_academic_assignments (
      student_id, academic_level_id, course_id, year_level_id, section_id, academic_year
    )
    select new.id, c.academic_level_id, c.id, s.year_level_id, s.id, s.academic_year
    from public.academic_sections s
    join public.courses c on c.id = s.course_id
    where s.id = section::uuid
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- User metadata is user-editable, so never use it to restore staff privileges.
insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  case
    when u.raw_app_meta_data ->> 'role' in ('student', 'teacher', 'admin')
      then u.raw_app_meta_data ->> 'role'
    else 'student'
  end
from auth.users u
where u.email is not null
  and (
    u.raw_app_meta_data ->> 'role' in ('student', 'teacher', 'admin')
    or coalesce(u.raw_user_meta_data ->> 'role', '') not in ('teacher', 'admin')
  )
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
