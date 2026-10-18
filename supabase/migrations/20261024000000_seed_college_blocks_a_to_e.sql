-- Seed generic College block options A-E.
-- These are database records and remain editable or archivable by admins.

do $$
declare
  program record;
  level record;
  block_letter text;
begin
  -- Retire the earlier generic numeric strand seed rows if those migrations
  -- were already applied. Keep the rows for history; do not delete them.
  update public.academic_sections section
  set is_active = false,
      archived_at = coalesce(archived_at, now()),
      updated_at = now()
  from public.courses course
  where section.course_id = course.id
    and course.code in ('ABM', 'HUMSS', 'STEM', 'TVL', 'ICT')
    and section.academic_year = '2026-2027'
    and section.created_by is null
    and section.section_name ~ '^(ABM|HUMSS|STEM|TVL|ICT) [1-5]$';

  for program in
    select id, code, academic_level_id
    from public.courses
    where is_active
      and code in ('BEED', 'BSED', 'BSIT', 'BSHM', 'BSENTREP')
  loop
    for level in
      select id, name
      from public.year_levels
      where is_active
        and name in ('1st Year', '2nd Year', '3rd Year', '4th Year')
    loop
      foreach block_letter in array ARRAY['A', 'B', 'C', 'D', 'E']
      loop
        insert into public.academic_sections (
          academic_level_id,
          course_id,
          year_level_id,
          section_code,
          section_name,
          academic_year,
          is_active
        )
        select
          program.academic_level_id,
          program.id,
          level.id,
          program.code || '-' || replace(level.name, ' ', '') || '-' || block_letter,
          'Block ' || block_letter,
          '2026-2027',
          true
        where not exists (
          select 1
          from public.academic_sections existing
          where existing.course_id = program.id
            and existing.year_level_id = level.id
            and existing.section_name = 'Block ' || block_letter
            and existing.academic_year = '2026-2027'
        );
      end loop;
    end loop;
  end loop;
end $$;
