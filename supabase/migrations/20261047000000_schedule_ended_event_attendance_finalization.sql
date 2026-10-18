-- Finalize ended events independently of app activity.

create extension if not exists pg_cron with schema pg_catalog;

revoke all on function public.finalize_event_attendance_internal(uuid) from public;

select cron.schedule(
  'finalize-ended-event-attendance',
  '* * * * *',
  $job$
    select public.finalize_event_attendance_internal(e.id)
    from public.events e
    where e.end_time <= now()
      and e.event_status is distinct from 'completed'
      and e.event_status is distinct from 'cancelled';
  $job$
);
