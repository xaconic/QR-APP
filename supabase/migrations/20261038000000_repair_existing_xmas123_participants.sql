-- One-time data repair for the existing event whose intended scope is known
-- from its configured roster: BSIT, 3rd Year, Block A.
-- This changes only participant configuration; event and attendance records remain intact.

delete from public.event_audience
where event_id in (select id from public.events where event_code = 'XMAS123');

insert into public.event_audience (event_id, course_id, year_level_id, section_id)
select e.id, c.id, y.id, s.id
from public.events e
cross join public.courses c
cross join public.year_levels y
cross join lateral (
  select s.id
  from public.academic_sections s
  where s.course_id = c.id
    and s.year_level_id = y.id
    and s.is_active
    and (s.section_name = 'Block A' or s.section_code = '3A')
  order by s.id
  limit 1
) s
where e.event_code = 'XMAS123'
  and c.code = 'BSIT'
  and y.name = '3rd Year';

update public.events
set audience_mode = 'groups'
where event_code = 'XMAS123';
