alter table public.profiles
  add column if not exists teacher_requested_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text := new.raw_app_meta_data ->> 'role';
  requested_role text := new.raw_user_meta_data ->> 'role';
  academic_level text := new.raw_user_meta_data ->> 'academic_level_id';
  course text := new.raw_user_meta_data ->> 'course_id';
  year_level text := new.raw_user_meta_data ->> 'year_level_id';
  section text := new.raw_user_meta_data ->> 'section_id';
begin
  if assigned_role is null or assigned_role not in ('student', 'teacher', 'admin') then
    assigned_role := 'student';
  end if;
  if requested_role is null or requested_role not in ('student', 'teacher') then
    requested_role := 'student';
  end if;

  if assigned_role = 'student' and requested_role = 'student' and (
    nullif(academic_level, '') is null
    or nullif(course, '') is null
    or nullif(year_level, '') is null
    or nullif(section, '') is null
  ) then
    raise exception 'Student academic information is required';
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    academic_level_id,
    course_id,
    year_level_id,
    section_id,
    teacher_requested_at
  )
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    assigned_role,
    case when assigned_role = 'student' and requested_role = 'student' then nullif(academic_level, '')::uuid end,
    case when assigned_role = 'student' and requested_role = 'student' then nullif(course, '')::uuid end,
    case when assigned_role = 'student' and requested_role = 'student' then nullif(year_level, '')::uuid end,
    case when assigned_role = 'student' and requested_role = 'student' then nullif(section, '')::uuid end,
    case when assigned_role = 'student' and requested_role = 'teacher' then now() end
  )
  on conflict (id) do nothing;

  if assigned_role = 'student' and requested_role = 'student' then
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

create or replace function public.admin_approve_teacher(p_user_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select * into target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User not found';
  end if;
  if target.role <> 'student' or target.teacher_requested_at is null then
    raise exception 'This account has no pending teacher request';
  end if;
  if not target.is_active then
    raise exception 'Reactivate this account before approving the teacher request';
  end if;

  update public.profiles
  set role = 'teacher',
      teacher_requested_at = null,
      academic_level_id = null,
      course_id = null,
      year_level_id = null,
      section_id = null,
      updated_at = now()
  where id = p_user_id
  returning * into target;

  update public.student_academic_assignments
  set ended_at = now()
  where student_id = p_user_id
    and ended_at is null;

  return target;
end;
$$;

revoke all on function public.admin_approve_teacher(uuid) from public;
grant execute on function public.admin_approve_teacher(uuid) to authenticated;
