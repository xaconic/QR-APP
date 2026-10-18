-- Remove the previously seeded institution-specific catalog without deleting
-- rows that may already be referenced by profiles or attendance history.
update public.courses
set is_active = false
where is_preliminary
  and code in ('BEED', 'BSED', 'BSIT', 'BSHM', 'BSENTREP', 'ABM', 'HUMSS', 'STEM', 'TVL', 'ICT');
