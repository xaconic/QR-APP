-- Generic academic-level and program configuration.
-- Programs are configured by administrators and are not hardcoded into the app.

create table if not exists public.academic_levels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.courses add column if not exists academic_level_id uuid references public.academic_levels(id) on delete restrict;
alter table public.courses add column if not exists is_preliminary boolean not null default true;
alter table public.profiles add column if not exists academic_level_id uuid references public.academic_levels(id) on delete set null;
alter table public.academic_sections add column if not exists academic_level_id uuid references public.academic_levels(id) on delete restrict;
alter table public.student_academic_assignments add column if not exists academic_level_id uuid references public.academic_levels(id) on delete restrict;

create table if not exists public.course_year_levels (
  course_id uuid not null references public.courses(id) on delete cascade,
  year_level_id uuid not null references public.year_levels(id) on delete cascade,
  primary key (course_id, year_level_id)
);

grant select on public.academic_levels, public.course_year_levels to anon, authenticated;
alter table public.academic_levels enable row level security;
alter table public.course_year_levels enable row level security;
drop policy if exists "Academic levels are readable" on public.academic_levels;
create policy "Academic levels are readable" on public.academic_levels for select to anon, authenticated using (is_active or public.is_admin());
drop policy if exists "Program year levels are readable" on public.course_year_levels;
create policy "Program year levels are readable" on public.course_year_levels for select to anon, authenticated using (true);

insert into public.academic_levels(code, name, sort_order) values
  ('COLLEGE', 'College', 1),
  ('SHS', 'Senior High School', 2)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.year_levels(name, sort_order) values
  ('1st Year', 1), ('2nd Year', 2), ('3rd Year', 3), ('4th Year', 4),
  ('Grade 11', 11), ('Grade 12', 12)
on conflict (name) do nothing;

insert into public.course_year_levels(course_id, year_level_id)
select c.id, y.id
from public.courses c
join public.academic_levels l on l.id=c.academic_level_id
join public.year_levels y on (l.code='COLLEGE' and y.name in ('1st Year','2nd Year','3rd Year','4th Year'))
  or (l.code='SHS' and y.name in ('Grade 11','Grade 12'))
on conflict do nothing;

update public.academic_sections s
set academic_level_id = c.academic_level_id
from public.courses c
where s.course_id=c.id and s.academic_level_id is null;

update public.profiles p
set academic_level_id = c.academic_level_id
from public.courses c
where p.course_id=c.id and p.academic_level_id is null;

create or replace function public.validate_profile_academic_group()
returns trigger language plpgsql security definer set search_path = public
as $$
declare target_course public.courses; target_section public.academic_sections;
begin
  if new.role <> 'student' and (new.academic_level_id is not null or new.course_id is not null or new.year_level_id is not null or new.section_id is not null) then
    raise exception 'Only students may have academic assignments';
  end if;
  if new.role = 'student' and (new.academic_level_id is not null or new.course_id is not null or new.year_level_id is not null or new.section_id is not null) then
    if new.academic_level_id is null or new.course_id is null or new.year_level_id is null or new.section_id is null then
      raise exception 'Academic level, program, year level, and section must be provided together';
    end if;
    select * into target_course from public.courses where id=new.course_id and is_active;
    if not found then raise exception 'Program not found'; end if;
    select * into target_section from public.academic_sections where id=new.section_id and is_active;
    if not found then raise exception 'Section not found'; end if;
    if target_course.academic_level_id <> new.academic_level_id or target_course.academic_level_id <> target_section.academic_level_id
      or target_section.course_id <> new.course_id or target_section.year_level_id <> new.year_level_id then
      raise exception 'Invalid academic level, program, year level, and section combination';
    end if;
    if not exists (select 1 from public.course_year_levels where course_id=new.course_id and year_level_id=new.year_level_id) then
      raise exception 'Year level is not configured for this program';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists validate_profile_academic_group on public.profiles;
create trigger validate_profile_academic_group before insert or update of role, academic_level_id, course_id, year_level_id, section_id on public.profiles for each row execute function public.validate_profile_academic_group();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (
    nullif(new.raw_user_meta_data ->> 'academic_level_id', '') is null or
    nullif(new.raw_user_meta_data ->> 'course_id', '') is null or
    nullif(new.raw_user_meta_data ->> 'year_level_id', '') is null or
    nullif(new.raw_user_meta_data ->> 'section_id', '') is null
  ) then raise exception 'Student academic information is required'; end if;
  insert into public.profiles(id,email,full_name,role,academic_level_id,course_id,year_level_id,section_id)
  values (
    new.id, new.email, nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    'student',
    nullif(new.raw_user_meta_data ->> 'academic_level_id','')::uuid,
    nullif(new.raw_user_meta_data ->> 'course_id','')::uuid,
    nullif(new.raw_user_meta_data ->> 'year_level_id','')::uuid,
    nullif(new.raw_user_meta_data ->> 'section_id','')::uuid
  ) on conflict (id) do nothing;
  insert into public.student_academic_assignments(student_id,academic_level_id,course_id,year_level_id,section_id,academic_year)
  select new.id,c.academic_level_id,c.id,s.year_level_id,s.id,s.academic_year
  from public.academic_sections s join public.courses c on c.id=s.course_id
  where s.id=nullif(new.raw_user_meta_data ->> 'section_id','')::uuid
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.admin_create_course(p_code text, p_name text, p_academic_level_id uuid)
returns public.courses language plpgsql security definer set search_path = public
as $$ declare result public.courses;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.academic_levels where id=p_academic_level_id and is_active) then raise exception 'Academic level not found'; end if;
  insert into public.courses(code,name,academic_level_id,created_by,is_preliminary) values (upper(btrim(p_code)),btrim(p_name),p_academic_level_id,auth.uid(),false) returning * into result;
  return result;
end; $$;

create or replace function public.admin_create_academic_level(p_code text, p_name text, p_sort_order integer default 0)
returns public.academic_levels language plpgsql security definer set search_path = public
as $$ declare result public.academic_levels;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  insert into public.academic_levels(code,name,sort_order) values(upper(btrim(p_code)),btrim(p_name),p_sort_order) returning * into result;
  return result;
end; $$;
revoke all on function public.admin_create_academic_level(text,text,integer) from public;
grant execute on function public.admin_create_academic_level(text,text,integer) to authenticated;

create or replace function public.admin_set_course_year_levels(p_course_id uuid, p_year_level_ids uuid[])
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.courses where id=p_course_id) then raise exception 'Course not found'; end if;
  delete from public.course_year_levels where course_id=p_course_id;
  insert into public.course_year_levels(course_id,year_level_id)
  select p_course_id, value from unnest(p_year_level_ids) value
  where exists (select 1 from public.year_levels where id=value and is_active);
end; $$;
revoke all on function public.admin_set_course_year_levels(uuid,uuid[]) from public;
grant execute on function public.admin_set_course_year_levels(uuid,uuid[]) to authenticated;

create or replace function public.admin_assign_student(
  p_student_id uuid, p_course_id uuid, p_year_level_id uuid, p_section_id uuid, p_academic_year text
)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare result public.profiles; target public.academic_sections; target_course public.courses;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  select * into target from public.academic_sections where id=p_section_id and is_active;
  if not found then raise exception 'Section not found'; end if;
  select * into target_course from public.courses where id=p_course_id and is_active;
  if not found then raise exception 'Course not found'; end if;
  if target.course_id<>p_course_id or target.year_level_id<>p_year_level_id or target.academic_year<>p_academic_year or target_course.academic_level_id<>target.academic_level_id then raise exception 'Invalid academic group'; end if;
  if not exists (select 1 from public.course_year_levels where course_id=p_course_id and year_level_id=p_year_level_id) then raise exception 'Year level is not configured for this program'; end if;
  update public.student_academic_assignments set ended_at=now() where student_id=p_student_id and ended_at is null;
  insert into public.student_academic_assignments(student_id,academic_level_id,course_id,year_level_id,section_id,academic_year)
  values(p_student_id,target_course.academic_level_id,p_course_id,p_year_level_id,p_section_id,p_academic_year);
  update public.profiles set academic_level_id=target_course.academic_level_id,course_id=p_course_id,year_level_id=p_year_level_id,section_id=p_section_id,updated_at=now()
  where id=p_student_id and role='student' returning * into result;
  if not found then raise exception 'Student not found'; end if;
  return result;
end; $$;

revoke all on function public.admin_create_course(text,text,uuid) from public;
grant execute on function public.admin_create_course(text,text,uuid) to authenticated;

create or replace function public.admin_update_course(p_course_id uuid, p_code text, p_name text)
returns public.courses language plpgsql security definer set search_path = public
as $$ declare result public.courses;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.courses set code=upper(btrim(p_code)), name=btrim(p_name) where id=p_course_id and is_active returning * into result;
  if not found then raise exception 'Course not found'; end if;
  return result;
end; $$;

create or replace function public.admin_archive_course(p_course_id uuid)
returns public.courses language plpgsql security definer set search_path = public
as $$ declare result public.courses;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.courses set is_active=false where id=p_course_id returning * into result;
  if not found then raise exception 'Course not found'; end if;
  return result;
end; $$;
revoke all on function public.admin_update_course(uuid,text,text) from public;
grant execute on function public.admin_update_course(uuid,text,text) to authenticated;
revoke all on function public.admin_archive_course(uuid) from public;
grant execute on function public.admin_archive_course(uuid) to authenticated;

create or replace function public.admin_create_section(
  p_course_id uuid, p_year_level_id uuid, p_section_code text, p_section_name text, p_academic_year text
)
returns public.academic_sections language plpgsql security definer set search_path = public
as $$ declare result public.academic_sections; target_course public.courses;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  select * into target_course from public.courses where id=p_course_id and is_active;
  if not found then raise exception 'Course not found'; end if;
  if not exists (select 1 from public.course_year_levels where course_id=p_course_id and year_level_id=p_year_level_id) then raise exception 'Year level is not configured for this program'; end if;
  insert into public.academic_sections(academic_level_id,course_id,year_level_id,section_code,section_name,academic_year,created_by)
  values(target_course.academic_level_id,p_course_id,p_year_level_id,upper(btrim(p_section_code)),btrim(p_section_name),btrim(p_academic_year),auth.uid()) returning * into result;
  return result;
end; $$;
revoke all on function public.admin_create_section(uuid,uuid,text,text,text) from public;
grant execute on function public.admin_create_section(uuid,uuid,text,text,text) to authenticated;
