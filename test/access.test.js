import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { asAnon, asOutsider, asStaff, createDb, OUTSIDER_ID, rpc, STAFF_ID, value } from './support/db.js';
import { addMember, addPackage, addVehicle, addZone } from './support/fixtures.js';

const TABLES = [
  'staff', 'members', 'vehicles', 'zones', 'spots', 'packages',
  'package_zones', 'subscriptions', 'visits', 'payments',
];
const VIEWS = ['spot_status', 'subscription_status', 'member_overview', 'visit_history', 'payment_history'];
const RPC_CALLS = [
  ['subscribe', 'public.subscribe(1, 1)'],
  ['cancel_subscription', 'public.cancel_subscription(1)'],
  ['record_payment', `public.record_payment(1, 'cash')`],
  ['gate_lookup', `public.gate_lookup('กก')`],
  ['check_in', 'public.check_in(1)'],
  ['check_out', 'public.check_out(1)'],
  ['save_package', `public.save_package(null, '{}'::jsonb)`],
  ['dashboard_summary', 'public.dashboard_summary()'],
  ['payment_total', `public.payment_total('paid')`],
];

let db;
let member;

before(async () => {
  db = await createDb();
  member = await addMember(db);
  await addVehicle(db, member.id);
  await addZone(db);
  const pkg = await addPackage(db);
  await rpc(db, 'subscribe', member.id, pkg.id, 'cash', null);
});
after(() => db.close());

test('row level security is on for every table', async () => {
  const missing = await value(
    db,
    `select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
  );
  assert.equal(missing, 0);
});

test('every table and view in public is covered by these tests', async () => {
  const rows = (await db.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v') order by 1`,
  )).rows.map((r) => r.relname);
  assert.deepEqual(rows, [...TABLES, ...VIEWS].sort());
});

test('anonymous callers can read nothing', async () => {
  for (const name of [...TABLES, ...VIEWS]) {
    await assert.rejects(asAnon(db, `select * from public.${name}`), /permission denied/, name);
  }
});

test('anonymous callers can write nothing', async () => {
  await assert.rejects(
    asAnon(db, `insert into public.members (full_name, phone) values ('ผู้บุกรุก', '0899999999')`),
    /permission denied/,
  );
  await assert.rejects(asAnon(db, `delete from public.members`), /permission denied/);
});

test('anonymous callers cannot execute any RPC', async () => {
  for (const [name, call] of RPC_CALLS) {
    await assert.rejects(asAnon(db, `select ${call}`), /permission denied/, name);
  }
});

test('a signed-in user who is not staff sees no rows', async () => {
  for (const name of [...TABLES, ...VIEWS]) {
    assert.deepEqual(await asOutsider(db, `select * from public.${name}`), [], name);
  }
});

test('a signed-in user who is not staff cannot write', async () => {
  await assert.rejects(
    asOutsider(db, `insert into public.members (full_name, phone) values ('ผู้บุกรุก', '0899999998')`),
    /row-level security/,
  );
  assert.deepEqual(await asOutsider(db, `update public.members set full_name = 'แก้ไข' returning id`), []);
  assert.deepEqual(await asOutsider(db, `delete from public.members returning id`), []);
});

test('a signed-in user who is not staff is rejected by every RPC', async () => {
  for (const [name, call] of RPC_CALLS) {
    await assert.rejects(asOutsider(db, `select ${call}`), /ไม่มีสิทธิ์ใช้งานระบบ/, name);
  }
});

test('nobody can promote themselves to staff', async () => {
  await assert.rejects(
    asOutsider(db, `insert into public.staff (user_id, full_name) values ($1, 'แฮกเกอร์')`, [OUTSIDER_ID]),
    /permission denied/,
  );
  await assert.rejects(
    asStaff(db, `insert into public.staff (user_id, full_name) values ($1, 'เพื่อน')`, [OUTSIDER_ID]),
    /permission denied/,
  );
});

test('staff see only their own row in the staff table', async () => {
  await db.query(`insert into public.staff (user_id, full_name) values ($1, 'อีกคน')`, [OUTSIDER_ID]);
  const rows = await asStaff(db, `select user_id from public.staff`);
  assert.deepEqual(rows.map((r) => r.user_id), [STAFF_ID]);
  await db.query(`delete from public.staff where user_id = $1`, [OUTSIDER_ID]);
});

test('staff cannot change money or history directly', async () => {
  for (const sql of [
    `update public.payments set amount = 0`,
    `update public.payments set status = 'paid'`,
    `delete from public.payments`,
    `insert into public.payments (member_id, kind, amount) values (1, 'overage', 0)`,
    `update public.subscriptions set end_date = '2099-01-01'`,
    `delete from public.subscriptions`,
    `update public.visits set fee = 0`,
    `delete from public.visits`,
    `delete from public.package_zones`,
  ]) {
    await assert.rejects(asStaff(db, sql), /permission denied/, sql);
  }
});

test('internal functions cannot be called directly', async () => {
  await assert.rejects(
    asStaff(db, `select private.apply_payment(1, 'cash', null)`),
    /permission denied/,
  );
});

test('every security definer function pins its search_path', async () => {
  const unsafe = await value(
    db,
    `select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
       and not coalesce(p.proconfig::text[] @> array['search_path=""'], false)`,
  );
  assert.equal(unsafe, 0);
});

test('staff can manage reference data directly', async () => {
  const [row] = await asStaff(
    db,
    `insert into public.members (full_name, phone) values ('สมาชิกใหม่', '0811111111') returning code`,
  );
  assert.match(row.code, /^MB\d{4}$/);
  const zones = await asStaff(db, `select id from public.zones`);
  assert.ok(zones.length > 0);
});

test('member codes do not lose digits past 9999', async () => {
  const code = await value(
    db,
    `insert into public.members (id, full_name, phone) overriding system value
     values (12345, 'เลขยาว', '0822222222') returning code`,
  );
  assert.equal(code, 'MB12345');
});
