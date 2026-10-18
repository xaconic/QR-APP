-- Complete the existing XMAS123 repair when the section is stored under a
-- different display/code value (for example 3A instead of Block A).

delete from public.event_audience
where event_id in (select id from public.events where event_code = 'XMAS123');

insert into public.event_audience (event_id, course_id, year_level_id, section_id)
select e.id, c.id, y.id, s.id
from public.events e
join public.courses c on c.code = 'BSIT'
join public.year_levels y on y.name = '3rd Year'
join public.academic_sections s
  on s.course_id = c.id
 and s.year_level_id = y.id
 and s.is_active
where e.event_code = 'XMAS123'
  and (
    lower(s.section_name) like '%block a%'
    or lower(s.section_name) like '%3a%'
    or lower(s.section_code) like '%block a%'
    or lower(s.section_code) like '%3a%'
  )
order by s.id
limit 1;

update public.events
set audience_mode = case
  when exists (select 1 from public.event_audience a where a.event_id = public.events.id) then 'groups'
  else 'legacy'
end
where event_code = 'XMAS123';
