-- Allow administrators to permanently delete any event while preserving the
-- existing teacher-owner deletion rule. This is intentionally separate from
-- archiving because permanent deletion removes related attendance history.

create or replace function public.delete_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.events;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into target
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Event not found';
  end if;

  if not (
    public.is_admin()
    or (
      target.created_by = auth.uid()
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'teacher'
          and p.is_active
      )
    )
  ) then
    raise exception 'Not authorized to delete this event';
  end if;

  delete from public.events where id = p_event_id;
  return target;
end;
$$;

revoke all on function public.delete_event(uuid) from public;
grant execute on function public.delete_event(uuid) to authenticated;
