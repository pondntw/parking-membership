import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { asStaff, createDb, one, rpc, value } from './support/db.js';
import { addMember, addPackage, addVehicle, dateOffset, today } from './support/fixtures.js';

let db;
before(async () => { db = await createDb(); });
after(() => db.close());

const dates = (db, id) => one(
  db,
  `select to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date
   from public.subscriptions where id = $1`,
  [id],
);

test('a first subscription starts today and stays pending until paid', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db, { price: 1500, duration_days: 30 });

  const sub = await rpc(db, 'subscribe', member.id, pkg.id, null, null);

  assert.equal(sub.status, 'pending');
  assert.equal(sub.kind, 'new');
  const payment = await one(db, `select * from public.payments where subscription_id = $1`, [sub.id]);
  assert.equal(payment.status, 'pending');
  assert.equal(Number(payment.amount), 1500);
  assert.deepEqual({ ...(await dates(db, sub.id)) }, {
    start_date: await today(db), end_date: await dateOffset(db, 29),
  });
});

test('paying during sign-up activates the term and records who took the money', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db);

  const sub = await rpc(db, 'subscribe', member.id, pkg.id, 'transfer', 'REF-1');

  assert.equal(sub.status, 'paid');
  const payment = await one(db, `select * from public.payments where subscription_id = $1`, [sub.id]);
  assert.equal(payment.method, 'transfer');
  assert.equal(payment.reference, 'REF-1');
  assert.ok(payment.recorded_by);
});

test('renewing an active term continues from the day after it ends', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db, { duration_days: 30 });
  const first = await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);
  const second = await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);

  assert.equal(second.kind, 'renewal');
  assert.deepEqual({ ...(await dates(db, second.id)) }, {
    start_date: await dateOffset(db, 30), end_date: await dateOffset(db, 59),
  });
  assert.equal((await dates(db, first.id)).end_date, await dateOffset(db, 29));
});

test('renewing after expiry starts today', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db, { duration_days: 30 });
  const first = await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);
  await db.query(
    `update public.subscriptions set start_date = private.bangkok_today() - 40, end_date = private.bangkok_today() - 11 where id = $1`,
    [first.id],
  );

  const renewal = await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);

  assert.equal(renewal.kind, 'renewal');
  assert.equal((await dates(db, renewal.id)).start_date, await today(db));
});

test('paying late moves the term forward so no days are lost', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db, { duration_days: 30 });
  const sub = await rpc(db, 'subscribe', member.id, pkg.id, null, null);
  await db.query(
    `update public.subscriptions set start_date = private.bangkok_today() - 5, end_date = private.bangkok_today() + 24 where id = $1`,
    [sub.id],
  );
  const paymentId = await value(db, `select id from public.payments where subscription_id = $1`, [sub.id]);

  await rpc(db, 'record_payment', paymentId, 'cash', null);

  assert.deepEqual({ ...(await dates(db, sub.id)) }, {
    start_date: await today(db), end_date: await dateOffset(db, 29),
  });
});

test('the term keeps its purchase price and quota when the package changes later', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db, { price: 1000, included_hours: 40, overage_rate: 20 });
  const sub = await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);

  await db.query(`update public.packages set price = 9999, included_hours = 1, overage_rate = 500 where id = $1`, [pkg.id]);

  const stored = await one(db, `select * from public.subscriptions where id = $1`, [sub.id]);
  assert.equal(Number(stored.price), 1000);
  assert.equal(stored.included_hours, 40);
  assert.equal(Number(stored.overage_rate), 20);
});

test('a second pending subscription is refused', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db);
  await rpc(db, 'subscribe', member.id, pkg.id, null, null);

  await assert.rejects(rpc(db, 'subscribe', member.id, pkg.id, null, null), /ค้างชำระ/);
});

test('suspended members and closed packages cannot subscribe', async () => {
  const suspended = await addMember(db, { status: 'suspended' });
  const pkg = await addPackage(db);
  await assert.rejects(rpc(db, 'subscribe', suspended.id, pkg.id, null, null), /ถูกระงับ/);

  const member = await addMember(db);
  const closed = await addPackage(db);
  await db.query(`update public.packages set is_active = false where id = $1`, [closed.id]);
  await assert.rejects(rpc(db, 'subscribe', member.id, closed.id, null, null), /ไม่เปิดให้สมัคร/);
});

test('a package with fewer vehicle slots than the member owns is refused', async () => {
  const member = await addMember(db);
  await addVehicle(db, member.id);
  await addVehicle(db, member.id);
  const pkg = await addPackage(db, { max_vehicles: 1 });

  await assert.rejects(rpc(db, 'subscribe', member.id, pkg.id, null, null), /เกินสิทธิ์/);
});

test('registering more vehicles than the active package allows is refused', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db, { max_vehicles: 1 });
  await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);
  await addVehicle(db, member.id);

  await assert.rejects(addVehicle(db, member.id), /ไม่เกิน 1 คัน/);
});

test('cancelling works only while unpaid and voids the payment', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db);
  const sub = await rpc(db, 'subscribe', member.id, pkg.id, null, null);

  const cancelled = await rpc(db, 'cancel_subscription', sub.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await value(db, `select status from public.payments where subscription_id = $1`, [sub.id]), 'void');

  const paid = await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);
  await assert.rejects(rpc(db, 'cancel_subscription', paid.id), /เฉพาะรายการที่ยังไม่ชำระ/);
});

test('a payment cannot be recorded twice or without a valid method', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db);
  const sub = await rpc(db, 'subscribe', member.id, pkg.id, null, null);
  const paymentId = await value(db, `select id from public.payments where subscription_id = $1`, [sub.id]);

  await assert.rejects(rpc(db, 'record_payment', paymentId, 'bitcoin', null), /วิธีชำระเงิน/);
  await rpc(db, 'record_payment', paymentId, 'cash', null);
  await assert.rejects(rpc(db, 'record_payment', paymentId, 'cash', null), /สถานะรอชำระ/);
});

test('payment_total adds up one status inside a Bangkok date range', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db, { price: 111.5 });
  const before = Number(await rpc(db, 'payment_total', 'paid', await today(db), await today(db)));
  await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);

  assert.equal(Number(await rpc(db, 'payment_total', 'paid', await today(db), await today(db))), before + 111.5);
  assert.equal(Number(await rpc(db, 'payment_total', 'paid', await dateOffset(db, 1), await dateOffset(db, 2))), 0);
});

test('subscription_status reports the state of each term', async () => {
  const member = await addMember(db);
  const pkg = await addPackage(db);
  const active = await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);
  const upcoming = await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);
  const pending = await rpc(db, 'subscribe', member.id, pkg.id, null, null);

  const rows = await asStaff(db, `select id, state from public.subscription_status where member_id = $1 order by id`, [member.id]);

  assert.deepEqual(rows.map((r) => [r.id, r.state]), [
    [active.id, 'active'], [upcoming.id, 'upcoming'], [pending.id, 'pending'],
  ]);
});

test('save_package stores zone rights together with the package', async () => {
  const [{ id: zoneId }] = await asStaff(db, `insert into public.zones (name, vehicle_type) values ('สิทธิ์ทดสอบ', 'car') returning id`);
  const pkg = await rpc(db, 'save_package', null, JSON.stringify({
    name: 'แพ็กเกจจากฟังก์ชัน', price: 500, duration_days: 7, max_vehicles: 1,
    included_hours: null, overage_rate: 10, access_start: '06:00', access_end: '22:00',
  }), [zoneId]);

  assert.equal(await value(db, `select count(*)::integer from public.package_zones where package_id = $1`, [pkg.id]), 1);

  await assert.rejects(rpc(db, 'save_package', pkg.id, JSON.stringify({
    name: 'แพ็กเกจจากฟังก์ชัน', price: -1, duration_days: 7, max_vehicles: 1, overage_rate: 10,
  }), []));
  assert.equal(
    await value(db, `select count(*)::integer from public.package_zones where package_id = $1`, [pkg.id]),
    1,
    'a failed save must keep the existing zone rights',
  );
});
