-- Read models for the web app. security_invoker keeps the caller's RLS in force.

create view public.spot_status with (security_invoker = true) as
select
  s.id, s.zone_id, z.name as zone_name, z.vehicle_type, s.code, s.out_of_service,
  case
    when v.id is not null then 'occupied'
    when s.out_of_service then 'out_of_service'
    else 'available'
  end as status,
  v.id as visit_id, v.entry_time, ve.plate, ve.province, m.full_name as member_name
from public.spots s
join public.zones z on z.id = s.zone_id
left join public.visits v on v.spot_id = s.id and v.exit_time is null
left join public.vehicles ve on ve.id = v.vehicle_id
left join public.members m on m.id = v.member_id;

create view public.subscription_status with (security_invoker = true) as
select
  s.id, s.member_id, s.package_id, s.kind, s.status, s.start_date, s.end_date,
  s.price, s.duration_days, s.included_hours, s.overage_rate, s.created_at,
  case
    when s.status <> 'paid' then s.status
    when s.end_date < (now() at time zone 'Asia/Bangkok')::date then 'expired'
    when s.start_date > (now() at time zone 'Asia/Bangkok')::date then 'upcoming'
    else 'active'
  end as state,
  m.code as member_code, m.full_name as member_name, m.phone as member_phone,
  p.name as package_name,
  pay.id as payment_id
from public.subscriptions s
join public.members m on m.id = s.member_id
join public.packages p on p.id = s.package_id
left join public.payments pay on pay.subscription_id = s.id;

create view public.member_overview with (security_invoker = true) as
select
  m.*,
  (select count(*) from public.vehicles v where v.member_id = m.id) as vehicle_count,
  (select max(s.end_date) from public.subscriptions s
   where s.member_id = m.id and s.status = 'paid') as paid_until
from public.members m;

create view public.visit_history with (security_invoker = true) as
select
  v.id, v.vehicle_id, v.member_id, v.subscription_id, v.spot_id,
  v.entry_time, v.exit_time, v.duration_min, v.chargeable_min, v.fee,
  ve.plate, ve.province, ve.type as vehicle_type,
  m.code as member_code, m.full_name as member_name,
  sp.code as spot_code, z.name as zone_name,
  pay.status as payment_status
from public.visits v
join public.vehicles ve on ve.id = v.vehicle_id
join public.members m on m.id = v.member_id
join public.spots sp on sp.id = v.spot_id
join public.zones z on z.id = sp.zone_id
left join public.payments pay on pay.visit_id = v.id;

create view public.payment_history with (security_invoker = true) as
select
  p.id, p.member_id, p.kind, p.subscription_id, p.visit_id, p.amount, p.status,
  p.method, p.reference, p.created_at, p.paid_at,
  coalesce(p.paid_at, p.created_at) as event_at,
  m.code as member_code, m.full_name as member_name
from public.payments p
join public.members m on m.id = p.member_id;

grant select on
  public.spot_status, public.subscription_status, public.member_overview,
  public.visit_history, public.payment_history
to authenticated;
