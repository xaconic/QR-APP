create or replace function public.get_student_discovery_events()
returns table (
  id uuid,
  event_code text,
  title text,
  start_time timestamptz,
  end_time timestamptz,
  created_by uuid,
  created_at timestamptz,
  status text,
  event_status text,
  venue text,
  description text,
  archived_at timestamptz,
  audience_mode text,
  attended boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.event_code, e.title, e.start_time, e.end_time, e.created_by, e.created_at,
    e.status, e.event_status, e.venue, e.description, e.archived_at, e.audience_mode,
    exists (
      select 1
      from public.attendance a
      where a.event_id = e.id
        and a.student_id = auth.uid()
        and a.status in ('present', 'late')
    )
  from public.events e
  where exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'student'
        and p.is_active
    )
    and e.archived_at is null
    and (
      public.student_is_in_event_audience(e.id, auth.uid())
      or exists (
        select 1
        from public.attendance a
        where a.event_id = e.id
          and a.student_id = auth.uid()
      )
    )
  order by e.start_time asc nulls first;
$$;

revoke all on function public.get_student_discovery_events() from public;
grant execute on function public.get_student_discovery_events() to authenticated;
