-- Access control. Supabase grants anon and authenticated full access to new
-- objects in public by default, so everything is revoked and granted back
-- explicitly. Only people listed in public.staff can read or change data.

create function private.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.staff where user_id = auth.uid()) $$;

create function private.require_staff()
returns void language plpgsql stable set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'ไม่มีสิทธิ์ใช้งานระบบ' using errcode = '42501';
  end if;
end;
$$;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.staff enable row level security;
alter table public.members enable row level security;
alter table public.vehicles enable row level security;
alter table public.zones enable row level security;
alter table public.spots enable row level security;
alter table public.packages enable row level security;
alter table public.package_zones enable row level security;
alter table public.subscriptions enable row level security;
alter table public.visits enable row level security;
alter table public.payments enable row level security;

-- Reference data: staff may edit it directly.
grant select, insert, update, delete on
  public.members, public.vehicles, public.zones, public.spots, public.packages
to authenticated;

create policy staff_all on public.members for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy staff_all on public.vehicles for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy staff_all on public.zones for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy staff_all on public.spots for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy staff_all on public.packages for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- Money and timestamps: read-only here, written only through RPCs. Package zones
-- also go through save_package, because a package left with no zones means
-- every zone.
grant select on
  public.package_zones, public.subscriptions, public.visits, public.payments
to authenticated;

create policy staff_read on public.package_zones for select to authenticated
  using ((select private.is_staff()));
create policy staff_read on public.subscriptions for select to authenticated
  using ((select private.is_staff()));
create policy staff_read on public.visits for select to authenticated
  using ((select private.is_staff()));
create policy staff_read on public.payments for select to authenticated
  using ((select private.is_staff()));

-- Staff accounts are managed from the dashboard. The app only checks its own row.
grant select on public.staff to authenticated;

create policy read_own_row on public.staff for select to authenticated
  using (user_id = (select auth.uid()));
