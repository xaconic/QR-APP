-- Add the remaining generic Senior High section options for existing databases.
-- These remain editable and archivable by administrators.

do $$
declare
  strand record;
  level record;
  section_number integer;
begin
  for strand in
    select id, code, academic_level_id
    from public.courses
    where is_active
      and code in ('ABM', 'HUMSS', 'STEM', 'TVL', 'ICT')
  loop
    for level in
      select id
      from public.year_levels
      where is_active
        and name in ('Grade 11', 'Grade 12')
    loop
      for section_number in 3..5
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
          strand.academic_level_id,
          strand.id,
          level.id,
          strand.code || '-' || section_number,
          strand.code || ' ' || section_number,
          '2026-2027',
          true
        where not exists (
          select 1
          from public.academic_sections existing
          where existing.course_id = strand.id
            and existing.year_level_id = level.id
            and existing.section_name = strand.code || ' ' || section_number
            and existing.academic_year = '2026-2027'
        );
      end loop;
    end loop;
  end loop;
end $$;
