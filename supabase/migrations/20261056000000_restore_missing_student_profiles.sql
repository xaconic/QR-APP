with valid_student_groups as (
  select
    u.id as student_id,
    academic_level.id as academic_level_id,
    course.id as course_id,
    year_level.id as year_level_id,
    section.id as section_id,
    section.academic_year
  from auth.users u
  join public.academic_levels academic_level
    on academic_level.id::text = u.raw_user_meta_data ->> 'academic_level_id'
    and academic_level.is_active
  join public.courses course
    on course.id::text = u.raw_user_meta_data ->> 'course_id'
    and course.academic_level_id = academic_level.id
    and course.is_active
  join public.year_levels year_level
    on year_level.id::text = u.raw_user_meta_data ->> 'year_level_id'
    and year_level.is_active
  join public.course_year_levels configured_year
    on configured_year.course_id = course.id
    and configured_year.year_level_id = year_level.id
  join public.academic_sections section
    on section.id::text = u.raw_user_meta_data ->> 'section_id'
    and section.academic_level_id = academic_level.id
    and section.course_id = course.id
    and section.year_level_id = year_level.id
    and section.is_active
)
insert into public.profiles (
  id, email, full_name, role, academic_level_id, course_id, year_level_id, section_id
)
select
  u.id,
  u.email,
  nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  case
    when u.raw_app_meta_data ->> 'role' in ('student', 'teacher', 'admin')
      then u.raw_app_meta_data ->> 'role'
    else 'student'
  end,
  case when coalesce(u.raw_app_meta_data ->> 'role', 'student') not in ('teacher', 'admin')
    then academic_group.academic_level_id end,
  case when coalesce(u.raw_app_meta_data ->> 'role', 'student') not in ('teacher', 'admin')
    then academic_group.course_id end,
  case when coalesce(u.raw_app_meta_data ->> 'role', 'student') not in ('teacher', 'admin')
    then academic_group.year_level_id end,
  case when coalesce(u.raw_app_meta_data ->> 'role', 'student') not in ('teacher', 'admin')
    then academic_group.section_id end
from auth.users u
left join valid_student_groups academic_group on academic_group.student_id = u.id
where u.email is not null
  and (
    u.raw_app_meta_data ->> 'role' in ('student', 'teacher', 'admin')
    or coalesce(u.raw_user_meta_data ->> 'role', '') not in ('teacher', 'admin')
  )
on conflict (id) do update
set
  email = excluded.email,
  full_name = coalesce(public.profiles.full_name, excluded.full_name),
  academic_level_id = case
    when public.profiles.role = 'student'
      and public.profiles.academic_level_id is null
      and public.profiles.course_id is null
      and public.profiles.year_level_id is null
      and public.profiles.section_id is null
      then excluded.academic_level_id
    else public.profiles.academic_level_id
  end,
  course_id = case
    when public.profiles.role = 'student'
      and public.profiles.academic_level_id is null
      and public.profiles.course_id is null
      and public.profiles.year_level_id is null
      and public.profiles.section_id is null
      then excluded.course_id
    else public.profiles.course_id
  end,
  year_level_id = case
    when public.profiles.role = 'student'
      and public.profiles.academic_level_id is null
      and public.profiles.course_id is null
      and public.profiles.year_level_id is null
      and public.profiles.section_id is null
      then excluded.year_level_id
    else public.profiles.year_level_id
  end,
  section_id = case
    when public.profiles.role = 'student'
      and public.profiles.academic_level_id is null
      and public.profiles.course_id is null
      and public.profiles.year_level_id is null
      and public.profiles.section_id is null
      then excluded.section_id
    else public.profiles.section_id
  end
where public.profiles.role = excluded.role;

with valid_student_groups as (
  select
    u.id as student_id,
    academic_level.id as academic_level_id,
    course.id as course_id,
    year_level.id as year_level_id,
    section.id as section_id,
    section.academic_year
  from auth.users u
  join public.academic_levels academic_level
    on academic_level.id::text = u.raw_user_meta_data ->> 'academic_level_id'
    and academic_level.is_active
  join public.courses course
    on course.id::text = u.raw_user_meta_data ->> 'course_id'
    and course.academic_level_id = academic_level.id
    and course.is_active
  join public.year_levels year_level
    on year_level.id::text = u.raw_user_meta_data ->> 'year_level_id'
    and year_level.is_active
  join public.course_year_levels configured_year
    on configured_year.course_id = course.id
    and configured_year.year_level_id = year_level.id
  join public.academic_sections section
    on section.id::text = u.raw_user_meta_data ->> 'section_id'
    and section.academic_level_id = academic_level.id
    and section.course_id = course.id
    and section.year_level_id = year_level.id
    and section.is_active
)
insert into public.student_academic_assignments (
  student_id, academic_level_id, course_id, year_level_id, section_id, academic_year
)
select
  academic_group.student_id,
  academic_group.academic_level_id,
  academic_group.course_id,
  academic_group.year_level_id,
  academic_group.section_id,
  academic_group.academic_year
from valid_student_groups academic_group
join public.profiles profile
  on profile.id = academic_group.student_id
  and profile.role = 'student'
on conflict do nothing;
