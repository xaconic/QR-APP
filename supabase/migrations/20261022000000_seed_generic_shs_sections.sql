-- Seed editable, generic Senior High section options.
-- These are database records, not frontend hardcoding, and may be edited or archived by admins.

do $$
declare
  strand record;
  level record;
  section_number integer;
begin
  for strand in
    select id, code
    from public.courses
    where is_active
      and code in ('ABM', 'HUMSS', 'STEM', 'TVL', 'ICT')
  loop
    for level in
      select id, name
      from public.year_levels
      where is_active
        and name in ('Grade 11', 'Grade 12')
  loop
    for section_number in 1..5
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
        c.academic_level_id,
        strand.id,
        level.id,
        strand.code || '-' || replace(level.name, ' ', '') || '-' || section_number,
        strand.code || ' ' || section_number,
        '2026-2027',
        true
      from public.courses c
      where c.id = strand.id
        and not exists (
          select 1
          from public.academic_sections existing
          where existing.course_id = strand.id
            and existing.year_level_id = level.id
            and existing.section_code = strand.code || '-' || replace(level.name, ' ', '') || '-' || section_number
            and existing.academic_year = '2026-2027'
        );
    end loop;
    end loop;
  end loop;
end $$;
