-- ข้อมูลตัวอย่างสำหรับเดโม บุคคลและทะเบียนรถทั้งหมดเป็นข้อมูลสมมติ
-- ไม่ถูกรันอัตโนมัติ ถ้าต้องการให้วางไฟล์นี้ใน SQL Editor ของ Supabase บนฐานข้อมูลที่ยังว่าง

insert into public.zones (name, vehicle_type, description) values
  ('โซน A', 'car', 'รถยนต์ ชั้น 1'),
  ('โซน B', 'car', 'รถยนต์ ใกล้ทางเข้า'),
  ('โซน M', 'motorcycle', 'รถจักรยานยนต์');

insert into public.spots (zone_id, code)
select z.id, 'A-' || lpad(n::text, 2, '0')
from public.zones z, generate_series(1, 16) n where z.name = 'โซน A';

insert into public.spots (zone_id, code)
select z.id, 'B-' || lpad(n::text, 2, '0')
from public.zones z, generate_series(1, 8) n where z.name = 'โซน B';

insert into public.spots (zone_id, code)
select z.id, 'M-' || lpad(n::text, 2, '0')
from public.zones z, generate_series(1, 12) n where z.name = 'โซน M';

update public.spots set out_of_service = true where code = 'A-16';

insert into public.packages
  (name, price, duration_days, max_vehicles, included_hours, overage_rate, access_start, access_end)
values
  ('รายเดือนไม่จำกัด', 2500, 30, 2, null, 30, null, null),
  ('รายเดือน 60 ชั่วโมง', 1200, 30, 1, 60, 25, null, null),
  ('พนักงานกลางวัน', 900, 30, 1, null, 25, '06:00', '20:00'),
  ('มอเตอร์ไซค์รายเดือน', 300, 30, 1, null, 10, null, null);

insert into public.package_zones (package_id, zone_id)
select p.id, z.id from public.packages p, public.zones z
where (p.name = 'รายเดือนไม่จำกัด' and z.name in ('โซน A', 'โซน B'))
   or (p.name in ('รายเดือน 60 ชั่วโมง', 'พนักงานกลางวัน') and z.name = 'โซน A')
   or (p.name = 'มอเตอร์ไซค์รายเดือน' and z.name = 'โซน M');

insert into public.members (full_name, phone, email) values
  ('สมมติ ใจดี', '0800000001', 'somsmut@example.com'),
  ('ตัวอย่าง รักดี', '0800000002', 'tuayang@example.com'),
  ('ทดสอบ มีสุข', '0800000003', null),
  ('เดโม ศรีสวัสดิ์', '0800000004', 'demo@example.com'),
  ('จำลอง ยิ้มแย้ม', '0800000005', null),
  ('สาธิต พูนผล', '0800000006', null);

insert into public.vehicles (member_id, plate, province, type, brand, model, color)
select m.id, v.plate, v.province, v.type, v.brand, v.model, v.color
from (values
  ('0800000001', '1กข1111', 'กรุงเทพมหานคร', 'car', 'Toyota', 'Yaris', 'ขาว'),
  ('0800000001', '2กข2222', 'นนทบุรี', 'car', 'Honda', 'City', 'เทา'),
  ('0800000002', '3กค3333', 'กรุงเทพมหานคร', 'car', 'Mazda', '2', 'แดง'),
  ('0800000003', '4กง4444', 'ปทุมธานี', 'car', 'Nissan', 'Almera', 'ดำ'),
  ('0800000004', '5กจ5555', 'กรุงเทพมหานคร', 'motorcycle', 'Honda', 'Wave', 'น้ำเงิน'),
  ('0800000005', '6กฉ6666', 'สมุทรปราการ', 'car', 'Ford', 'Ranger', 'ขาว'),
  ('0800000006', '7กช7777', 'กรุงเทพมหานคร', 'car', 'Isuzu', 'D-Max', 'เงิน')
) as v(phone, plate, province, type, brand, model, color)
join public.members m on m.phone = v.phone;

-- รอบสมาชิก: ใช้งานอยู่ ใกล้หมดอายุ หมดอายุแล้ว และรอชำระ
with today as (select (now() at time zone 'Asia/Bangkok')::date as d),
terms as (
  select m.id as member_id, p.id as package_id, t.kind, t.status,
         today.d + t.start_offset as start_date, p.price, p.duration_days,
         p.included_hours, p.overage_rate
  from (values
    ('0800000001', 'รายเดือนไม่จำกัด', 'new', 'paid', -10),
    ('0800000002', 'รายเดือน 60 ชั่วโมง', 'new', 'paid', -5),
    ('0800000003', 'พนักงานกลางวัน', 'new', 'paid', -26),
    ('0800000004', 'มอเตอร์ไซค์รายเดือน', 'new', 'paid', -20),
    ('0800000005', 'รายเดือน 60 ชั่วโมง', 'new', 'paid', -45)
  ) as t(phone, package_name, kind, status, start_offset)
  join public.members m on m.phone = t.phone
  join public.packages p on p.name = t.package_name
  cross join today
),
inserted as (
  insert into public.subscriptions
    (member_id, package_id, kind, status, start_date, end_date, price, duration_days, included_hours, overage_rate)
  select member_id, package_id, kind, status, start_date, start_date + duration_days - 1,
         price, duration_days, included_hours, overage_rate
  from terms
  returning id, member_id, price, start_date
)
insert into public.payments (member_id, kind, subscription_id, amount, status, method, created_at, paid_at)
select member_id, 'subscription', id, price, 'paid', 'cash',
       start_date::timestamp at time zone 'Asia/Bangkok' + interval '9 hours',
       start_date::timestamp at time zone 'Asia/Bangkok' + interval '9 hours'
from inserted;

-- สมาชิกคนสุดท้ายสมัครแล้วแต่ยังไม่จ่าย
with new_term as (
  insert into public.subscriptions
    (member_id, package_id, kind, status, start_date, end_date, price, duration_days, included_hours, overage_rate)
  select m.id, p.id, 'new', 'pending', d.today, d.today + p.duration_days - 1,
         p.price, p.duration_days, p.included_hours, p.overage_rate
  from public.members m, public.packages p, (select (now() at time zone 'Asia/Bangkok')::date as today) d
  where m.phone = '0800000006' and p.name = 'รายเดือน 60 ชั่วโมง'
  returning id, member_id, price
)
insert into public.payments (member_id, kind, subscription_id, amount)
select member_id, 'subscription', id, price from new_term;

-- ประวัติการจอดที่จบแล้ว
insert into public.visits
  (vehicle_id, member_id, subscription_id, spot_id, entry_time, exit_time, duration_min, chargeable_min, fee)
select ve.id, ve.member_id, s.id, sp.id,
       now() - make_interval(days => h.days_ago, mins => h.minutes),
       now() - make_interval(days => h.days_ago),
       h.minutes, 0, 0
from (values
  ('1กข1111', 'A-01', 5, 480),
  ('1กข1111', 'B-02', 3, 540),
  ('3กค3333', 'A-03', 2, 300),
  ('4กง4444', 'A-05', 4, 600),
  ('5กจ5555', 'M-02', 1, 420)
) as h(plate, spot_code, days_ago, minutes)
join public.vehicles ve on ve.plate = h.plate
join public.spots sp on sp.code = h.spot_code
join public.subscriptions s on s.member_id = ve.member_id and s.status = 'paid';

-- รถที่จอดอยู่ตอนนี้
insert into public.visits (vehicle_id, member_id, subscription_id, spot_id, entry_time)
select ve.id, ve.member_id, s.id, sp.id, now() - make_interval(mins => h.minutes)
from (values
  ('2กข2222', 'B-01', 95),
  ('3กค3333', 'A-02', 40),
  ('5กจ5555', 'M-01', 180)
) as h(plate, spot_code, minutes)
join public.vehicles ve on ve.plate = h.plate
join public.spots sp on sp.code = h.spot_code
join public.subscriptions s on s.member_id = ve.member_id and s.status = 'paid';
