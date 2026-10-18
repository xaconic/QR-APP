-- Existing events without saved group rows are the legacy All Students shape.
-- Keep restricted events restricted because they have event_audience rows.

update public.events e
set audience_mode = 'all'
where not exists (
  select 1 from public.event_audience a where a.event_id = e.id
);
