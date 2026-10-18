-- Restore the configurable default program catalog without institution branding.
-- These remain editable/preliminary so administrators control the final offerings.

insert into public.courses(code, name, academic_level_id, is_active, is_preliminary)
values
  ('BEED', 'Bachelor of Elementary Education (BEEd)', (select id from public.academic_levels where code='COLLEGE'), true, true),
  ('BSED', 'Bachelor of Secondary Education (BSEd)', (select id from public.academic_levels where code='COLLEGE'), true, true),
  ('BSIT', 'Bachelor of Science in Information Technology (BSIT)', (select id from public.academic_levels where code='COLLEGE'), true, true),
  ('BSHM', 'Bachelor of Science in Hospitality Management (BSHM)', (select id from public.academic_levels where code='COLLEGE'), true, true),
  ('BSENTREP', 'Bachelor of Science in Entrepreneurship (BS Entrep)', (select id from public.academic_levels where code='COLLEGE'), true, true),
  ('ABM', 'Accountancy, Business, and Management (ABM)', (select id from public.academic_levels where code='SHS'), true, true),
  ('HUMSS', 'Humanities and Social Sciences (HUMSS)', (select id from public.academic_levels where code='SHS'), true, true),
  ('STEM', 'Science, Technology, Engineering, and Mathematics (STEM)', (select id from public.academic_levels where code='SHS'), true, true),
  ('TVL', 'Technical-Vocational-Livelihood (TVL)', (select id from public.academic_levels where code='SHS'), true, true),
  ('ICT', 'Information and Communications Technology (ICT)', (select id from public.academic_levels where code='SHS'), true, true)
on conflict (code) do update set
  academic_level_id = excluded.academic_level_id,
  is_active = true,
  is_preliminary = true;

insert into public.course_year_levels(course_id, year_level_id)
select c.id, y.id
from public.courses c
join public.academic_levels l on l.id=c.academic_level_id
join public.year_levels y on (l.code='COLLEGE' and y.name in ('1st Year','2nd Year','3rd Year','4th Year'))
  or (l.code='SHS' and y.name in ('Grade 11','Grade 12'))
on conflict do nothing;

update public.academic_sections s
set is_active = true, archived_at = null, academic_level_id = c.academic_level_id
from public.courses c
where s.course_id = c.id and c.is_active;
