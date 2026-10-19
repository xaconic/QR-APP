do $$
declare
  realtime_table text;
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise notice 'supabase_realtime publication is unavailable; app data change streams were not enabled';
    return;
  end if;

  foreach realtime_table in array array[
    'academic_levels',
    'academic_sections',
    'attendance',
    'course_year_levels',
    'courses',
    'event_audience',
    'event_staff',
    'events',
    'profiles',
    'student_academic_assignments',
    'year_levels'
  ]
  loop
    if to_regclass(format('public.%I', realtime_table)) is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = realtime_table
      ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    end if;
  end loop;
end;
$$;
