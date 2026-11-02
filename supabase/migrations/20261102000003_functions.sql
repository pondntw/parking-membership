-- Business rules. Public functions are the RPC surface: each one runs as the
-- owner so it can write tables that staff can only read, and checks for a staff
-- caller first. Times always come from the database clock, never the browser.

-- Fee = minutes over the term's quota + minutes after coverage ended, rounded
-- up to whole hours and multiplied by the rate.
create function private.calc_fee(
  p_entry timestamptz,
  p_exit timestamptz,
  p_coverage_end timestamptz,
  p_included_hours integer,
  p_used_min integer,
  p_rate numeric
)
returns table (total_min integer, chargeable_min integer, fee numeric)
language plpgsql immutable set search_path = ''
as $$
declare
  v_total integer := greatest(0, ceil(extract(epoch from p_exit - p_entry) / 60))::integer;
  v_outside integer := least(v_total, greatest(0, ceil(extract(epoch from p_exit - p_coverage_end) / 60)))::integer;
  v_inside integer := v_total - v_outside;
  v_over_quota integer := 0;
begin
  if p_included_hours is not null then
    v_over_quota := greatest(0, v_inside - greatest(0, p_included_hours * 60 - p_used_min));
  end if;

  total_min := v_total;
  chargeable_min := v_outside + v_over_quota;
  fee := round(ceil(chargeable_min / 60.0) * p_rate, 2);
  return next;
end;
$$;

create function private.used_minutes(p_subscription_id bigint)
returns integer language sql stable set search_path = ''
as $$
  select coalesce(sum(duration_min), 0)::integer from public.visits
  where subscription_id = p_subscription_id and exit_time is not null
$$;

create function private.visit_fee(p_visit public.visits, p_at timestamptz)
returns table (total_min integer, chargeable_min integer, fee numeric)
language plpgsql stable set search_path = ''
as $$
declare
  v_term public.subscriptions;
  v_coverage date;
begin
  select * into v_term from public.subscriptions where id = p_visit.subscription_id;
  -- A renewal bought while the car is parked keeps the whole stay covered.
  select max(end_date) into v_coverage from public.subscriptions
  where member_id = p_visit.member_id and status = 'paid';

  return query
  select * from private.calc_fee(
    p_visit.entry_time,
    p_at,
    ((v_coverage + 1)::timestamp at time zone 'Asia/Bangkok'),
    v_term.included_hours,
    private.used_minutes(v_term.id),
    v_term.overage_rate
  );
end;
$$;

create function private.eligible_spots(p_package_id bigint, p_vehicle_type text)
returns jsonb language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(r) order by r.zone_id, r.id), '[]'::jsonb)
  from (
    select s.id, s.code, z.id as zone_id, z.name as zone_name
    from public.spots s
    join public.zones z on z.id = s.zone_id
    where not s.out_of_service
      and z.vehicle_type = p_vehicle_type
      and not exists (select 1 from public.visits v where v.spot_id = s.id and v.exit_time is null)
      and (
        not exists (select 1 from public.package_zones pz where pz.package_id = p_package_id)
        or exists (select 1 from public.package_zones pz where pz.package_id = p_package_id and pz.zone_id = z.id)
      )
  ) r
$$;

-- Everything the gate needs to know about one vehicle. `denial` holds the reason
-- it may not enter, and check_in enforces the same answer the screen showed.
create function private.vehicle_status(p_vehicle public.vehicles)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  v_member public.members;
  v_visit public.visits;
  v_term public.subscriptions;
  v_package public.packages;
  v_spot_label text;
  v_preview jsonb;
  v_denial text;
  v_spots jsonb := '[]'::jsonb;
  v_time time := (now() at time zone 'Asia/Bangkok')::time;
  v_expired_on date;
begin
  select * into v_member from public.members where id = p_vehicle.member_id;
  select * into v_visit from public.visits where vehicle_id = p_vehicle.id and exit_time is null;
  v_term := private.active_term(v_member.id, private.bangkok_today());
  if v_term.id is not null then
    select * into v_package from public.packages where id = v_term.package_id;
  end if;

  if v_visit.id is not null then
    select to_jsonb(f) into v_preview from private.visit_fee(v_visit, now()) f;
    select z.name || ' / ' || s.code into v_spot_label
    from public.spots s join public.zones z on z.id = s.zone_id
    where s.id = v_visit.spot_id;
  elsif v_member.status = 'suspended' then
    v_denial := 'สมาชิกถูกระงับการใช้งาน';
  elsif v_term.id is null then
    select max(end_date) into v_expired_on from public.subscriptions
    where member_id = v_member.id and status = 'paid';
    v_denial := case
      when v_expired_on is null then 'สมาชิกยังไม่มีแพ็กเกจที่ชำระเงินแล้ว'
      else 'สมาชิกหมดอายุแล้ว กรุณาต่ออายุ'
    end;
  elsif v_package.access_start is not null and not (
    case when v_package.access_start <= v_package.access_end
      then v_time between v_package.access_start and v_package.access_end
      else v_time >= v_package.access_start or v_time <= v_package.access_end
    end
  ) then
    v_denial := format(
      'แพ็กเกจนี้เข้าจอดได้เฉพาะเวลา %s–%s น.',
      to_char(v_package.access_start, 'HH24:MI'),
      to_char(v_package.access_end, 'HH24:MI')
    );
  else
    v_spots := private.eligible_spots(v_package.id, p_vehicle.type);
    if jsonb_array_length(v_spots) = 0 then
      v_denial := 'ไม่มีช่องจอดว่างในโซนที่แพ็กเกจนี้ใช้ได้';
    end if;
  end if;

  return jsonb_build_object(
    'vehicle', to_jsonb(p_vehicle),
    'member', to_jsonb(v_member),
    'term', case when v_term.id is null then null else to_jsonb(v_term) end,
    'package', case when v_term.id is null then null else to_jsonb(v_package) end,
    'used_minutes', case when v_term.id is null then 0 else private.used_minutes(v_term.id) end,
    'outstanding', (
      select coalesce(sum(amount), 0) from public.payments
      where member_id = v_member.id and kind = 'overage' and status = 'pending'
    ),
    'open_visit', case when v_visit.id is null then null
      else to_jsonb(v_visit) || jsonb_build_object('spot_label', v_spot_label) end,
    'preview', v_preview,
    'denial', v_denial,
    'spots', v_spots
  );
end;
$$;

create function private.apply_payment(p_payment_id bigint, p_method text, p_reference text)
returns public.payments language plpgsql set search_path = ''
as $$
declare
  v_payment public.payments;
  v_sub public.subscriptions;
  v_last date;
  v_start date;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบรายการชำระเงิน' using errcode = 'P0001';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'รายการนี้ไม่ได้อยู่ในสถานะรอชำระ' using errcode = 'P0001';
  end if;
  if p_method is null or p_method not in ('cash', 'transfer', 'card') then
    raise exception 'กรุณาเลือกวิธีชำระเงิน' using errcode = 'P0001';
  end if;

  if v_payment.subscription_id is not null then
    select * into v_sub from public.subscriptions where id = v_payment.subscription_id for update;
    select max(end_date) into v_last from public.subscriptions
    where member_id = v_sub.member_id and status = 'paid';
    -- Paying late moves the term forward so the member doesn't lose days.
    v_start := greatest(v_sub.start_date, private.bangkok_today(), v_last + 1);
    update public.subscriptions
    set status = 'paid', start_date = v_start, end_date = v_start + duration_days - 1
    where id = v_sub.id;
  end if;

  update public.payments
  set status = 'paid', method = p_method, reference = nullif(btrim(p_reference), ''),
      paid_at = now(), recorded_by = auth.uid()
  where id = p_payment_id
  returning * into v_payment;

  return v_payment;
end;
$$;

-- Covers both signing up and renewing: a member with a paid term is renewing.
create function public.subscribe(
  p_member_id bigint,
  p_package_id bigint,
  p_method text default null,
  p_reference text default null
)
returns public.subscriptions language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_package public.packages;
  v_sub public.subscriptions;
  v_payment public.payments;
  v_last date;
  v_today date := private.bangkok_today();
  v_start date;
  v_vehicles integer;
begin
  perform private.require_staff();

  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    raise exception 'ไม่พบสมาชิก' using errcode = 'P0001';
  end if;
  if v_member.status = 'suspended' then
    raise exception 'สมาชิกถูกระงับการใช้งาน' using errcode = 'P0001';
  end if;

  select * into v_package from public.packages where id = p_package_id;
  if not found or not v_package.is_active then
    raise exception 'แพ็กเกจนี้ไม่เปิดให้สมัคร' using errcode = 'P0001';
  end if;

  select count(*) into v_vehicles from public.vehicles where member_id = p_member_id;
  if v_vehicles > v_package.max_vehicles then
    raise exception 'สมาชิกมีรถ % คัน เกินสิทธิ์ของแพ็กเกจนี้ (% คัน)', v_vehicles, v_package.max_vehicles
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.subscriptions where member_id = p_member_id and status = 'pending') then
    raise exception 'มีรายการค้างชำระอยู่ กรุณาชำระหรือยกเลิกก่อน' using errcode = 'P0001';
  end if;

  select max(end_date) into v_last from public.subscriptions
  where member_id = p_member_id and status = 'paid';
  v_start := greatest(v_today, v_last + 1);

  insert into public.subscriptions (
    member_id, package_id, kind, start_date, end_date,
    price, duration_days, included_hours, overage_rate
  )
  values (
    p_member_id, p_package_id,
    case when v_last is null then 'new' else 'renewal' end,
    v_start, v_start + v_package.duration_days - 1,
    v_package.price, v_package.duration_days, v_package.included_hours, v_package.overage_rate
  )
  returning * into v_sub;

  insert into public.payments (member_id, kind, subscription_id, amount)
  values (p_member_id, 'subscription', v_sub.id, v_package.price)
  returning * into v_payment;

  if p_method is not null then
    perform private.apply_payment(v_payment.id, p_method, p_reference);
    select * into v_sub from public.subscriptions where id = v_sub.id;
  end if;

  return v_sub;
end;
$$;

create function public.cancel_subscription(p_subscription_id bigint)
returns public.subscriptions language plpgsql security definer set search_path = ''
as $$
declare
  v_sub public.subscriptions;
begin
  perform private.require_staff();

  update public.subscriptions set status = 'cancelled'
  where id = p_subscription_id and status = 'pending'
  returning * into v_sub;
  if not found then
    raise exception 'ยกเลิกได้เฉพาะรายการที่ยังไม่ชำระ' using errcode = 'P0001';
  end if;

  update public.payments set status = 'void' where subscription_id = p_subscription_id;
  return v_sub;
end;
$$;

create function public.record_payment(p_payment_id bigint, p_method text, p_reference text default null)
returns public.payments language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_staff();
  return private.apply_payment(p_payment_id, p_method, p_reference);
end;
$$;

create function public.gate_lookup(p_plate text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_plate text := private.normalize_plate(p_plate);
begin
  perform private.require_staff();

  if v_plate = '' then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(jsonb_agg(private.vehicle_status(r.v)), '[]'::jsonb)
    from (
      select v from public.vehicles v
      where v.plate like '%' || replace(replace(v_plate, '%', ''), '_', '') || '%'
      order by v.plate = v_plate desc, v.plate, v.province
      limit 10
    ) r
  );
end;
$$;

create function public.check_in(p_vehicle_id bigint, p_spot_id bigint default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_vehicle public.vehicles;
  v_status jsonb;
  v_spot_id bigint := p_spot_id;
  v_visit public.visits;
begin
  perform private.require_staff();

  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if not found then
    raise exception 'ไม่พบรถคันนี้' using errcode = 'P0001';
  end if;

  v_status := private.vehicle_status(v_vehicle);
  if v_status -> 'open_visit' <> 'null'::jsonb then
    raise exception 'รถคันนี้อยู่ในลานจอดแล้ว' using errcode = 'P0001';
  end if;
  if v_status ->> 'denial' is not null then
    raise exception '%', v_status ->> 'denial' using errcode = 'P0001';
  end if;

  if v_spot_id is null then
    v_spot_id := (v_status -> 'spots' -> 0 ->> 'id')::bigint;
  elsif not exists (
    select 1 from jsonb_array_elements(v_status -> 'spots') e where (e ->> 'id')::bigint = v_spot_id
  ) then
    raise exception 'ช่องจอดนี้ไม่ว่าง หรือไม่อยู่ในสิทธิ์ของแพ็กเกจ' using errcode = 'P0001';
  end if;

  begin
    insert into public.visits (vehicle_id, member_id, subscription_id, spot_id, recorded_by)
    values (
      v_vehicle.id, v_vehicle.member_id, (v_status -> 'term' ->> 'id')::bigint, v_spot_id, auth.uid()
    )
    returning * into v_visit;
  exception when unique_violation then
    -- Two gates took the same spot, or recorded the same car, at the same moment.
    raise exception 'ช่องจอดหรือรถคันนี้เพิ่งถูกบันทึกไป กรุณาค้นหาใหม่' using errcode = 'P0001';
  end;

  return to_jsonb(v_visit) || jsonb_build_object(
    'spot_label',
    (select z.name || ' / ' || s.code from public.spots s
     join public.zones z on z.id = s.zone_id where s.id = v_spot_id),
    'outstanding', v_status -> 'outstanding'
  );
end;
$$;

-- With no p_method, any fee is left as a pending payment.
create function public.check_out(p_visit_id bigint, p_method text default null, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_visit public.visits;
  v_fee record;
  v_now timestamptz := now();
  v_payment public.payments;
begin
  perform private.require_staff();

  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรายการเข้าจอด' using errcode = 'P0001';
  end if;
  if v_visit.exit_time is not null then
    raise exception 'รายการนี้บันทึกออกไปแล้ว' using errcode = 'P0001';
  end if;

  select * into v_fee from private.visit_fee(v_visit, v_now);

  update public.visits
  set exit_time = v_now, duration_min = v_fee.total_min, chargeable_min = v_fee.chargeable_min,
      fee = v_fee.fee, exit_recorded_by = auth.uid()
  where id = p_visit_id
  returning * into v_visit;

  if v_fee.fee > 0 then
    insert into public.payments (member_id, kind, visit_id, amount)
    values (v_visit.member_id, 'overage', v_visit.id, v_fee.fee)
    returning * into v_payment;

    if p_method is not null then
      v_payment := private.apply_payment(v_payment.id, p_method, p_reference);
    end if;
  end if;

  return to_jsonb(v_visit) || jsonb_build_object('payment_status', v_payment.status);
end;
$$;

-- Saved in one transaction: a failed zone write must not leave the package with
-- no zones, which would silently mean every zone.
create function public.save_package(p_id bigint, p_package jsonb, p_zone_ids bigint[] default '{}')
returns public.packages language plpgsql security definer set search_path = ''
as $$
declare
  v_package public.packages;
begin
  perform private.require_staff();

  if p_id is null then
    insert into public.packages (
      name, price, duration_days, max_vehicles, included_hours, overage_rate,
      access_start, access_end, is_active
    )
    values (
      p_package ->> 'name', (p_package ->> 'price')::numeric, (p_package ->> 'duration_days')::integer,
      (p_package ->> 'max_vehicles')::integer, (p_package ->> 'included_hours')::integer,
      (p_package ->> 'overage_rate')::numeric, (p_package ->> 'access_start')::time,
      (p_package ->> 'access_end')::time, coalesce((p_package ->> 'is_active')::boolean, true)
    )
    returning * into v_package;
  else
    update public.packages
    set name = p_package ->> 'name',
        price = (p_package ->> 'price')::numeric,
        duration_days = (p_package ->> 'duration_days')::integer,
        max_vehicles = (p_package ->> 'max_vehicles')::integer,
        included_hours = (p_package ->> 'included_hours')::integer,
        overage_rate = (p_package ->> 'overage_rate')::numeric,
        access_start = (p_package ->> 'access_start')::time,
        access_end = (p_package ->> 'access_end')::time,
        is_active = coalesce((p_package ->> 'is_active')::boolean, true)
    where id = p_id
    returning * into v_package;
    if not found then
      raise exception 'ไม่พบแพ็กเกจ' using errcode = 'P0001';
    end if;
    delete from public.package_zones where package_id = v_package.id;
  end if;

  insert into public.package_zones (package_id, zone_id)
  select v_package.id, z from unnest(p_zone_ids) z;

  return v_package;
end;
$$;

create function public.dashboard_summary()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := private.bangkok_today();
  v_day_start timestamptz := v_today::timestamp at time zone 'Asia/Bangkok';
  v_day_end timestamptz := (v_today + 1)::timestamp at time zone 'Asia/Bangkok';
begin
  perform private.require_staff();

  return jsonb_build_object(
    'zones', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.id), '[]'::jsonb)
      from (
        select z.id, z.name, z.vehicle_type,
          count(s.id)::integer as total,
          count(s.id) filter (where v.id is not null)::integer as occupied,
          count(s.id) filter (where v.id is null and s.out_of_service)::integer as out_of_service
        from public.zones z
        left join public.spots s on s.zone_id = z.id
        left join public.visits v on v.spot_id = s.id and v.exit_time is null
        group by z.id
      ) r
    ),
    'active_members', (
      select count(distinct s.member_id) from public.subscriptions s
      join public.members m on m.id = s.member_id
      where m.status = 'active' and s.status = 'paid'
        and s.start_date <= v_today and s.end_date >= v_today
    ),
    'entries_today', (
      select count(*) from public.visits
      where entry_time >= v_day_start and entry_time < v_day_end
    ),
    'revenue_today', (
      select coalesce(sum(amount), 0) from public.payments
      where status = 'paid' and paid_at >= v_day_start and paid_at < v_day_end
    ),
    'pending_count', (select count(*) from public.payments where status = 'pending'),
    'pending_amount', (
      select coalesce(sum(amount), 0) from public.payments where status = 'pending'
    ),
    'expiring', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.end_date), '[]'::jsonb)
      from (
        select m.id, m.code, m.full_name, m.phone, max(s.end_date) as end_date
        from public.subscriptions s
        join public.members m on m.id = s.member_id
        where s.status = 'paid'
        group by m.id
        having max(s.end_date) between v_today and v_today + 7
      ) r
    )
  );
end;
$$;

-- Summed here because the API caps a list at 1000 rows, so a total added up in
-- the browser would quietly come out short.
create function public.payment_total(p_status text, p_from date default null, p_to date default null)
returns numeric language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_staff();

  return (
    select coalesce(sum(amount), 0) from public.payments
    where status = p_status
      and (p_from is null or coalesce(paid_at, created_at) >= p_from::timestamp at time zone 'Asia/Bangkok')
      and (p_to is null or coalesce(paid_at, created_at) < (p_to + 1)::timestamp at time zone 'Asia/Bangkok')
  );
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_staff() to authenticated;

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
