import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { asStaff, createDb, one, rpc, value } from './support/db.js';
import { addMember, addPackage, addVehicle, addZone, allowZones, openVisits, rewindEntry } from './support/fixtures.js';

let db;
let zone;

before(async () => { db = await createDb(); });
after(() => db.close());
beforeEach(async () => { zone = await addZone(db); });

async function paidMember({ pkg = {}, vehicle = {} } = {}) {
  const member = await addMember(db);
  const car = await addVehicle(db, member.id, vehicle);
  const plan = await addPackage(db, pkg);
  await allowZones(db, plan.id, zone.id);
  const term = await rpc(db, 'subscribe', member.id, plan.id, 'cash', null);
  return { member, car, plan, term };
}

const lookup = async (plate) => (await rpc(db, 'gate_lookup', plate))[0];

test('a member with a paid term gets a spot and appears as parked', async () => {
  const { car } = await paidMember();

  const visit = await rpc(db, 'check_in', car.id, null);

  assert.ok(visit.spot_id);
  assert.ok(visit.recorded_by);
  const status = await lookup(car.plate);
  assert.equal(status.open_visit.id, visit.id);
  assert.equal(status.denial, null);
});

test('plates are matched regardless of spaces, dashes and case', async () => {
  const member = await addMember(db);
  await addVehicle(db, member.id, { plate: 'ab 12-34' });

  const status = await lookup('Ab1234');

  assert.equal(status.vehicle.plate, 'AB1234');
});

test('the same plate in two provinces comes back as two vehicles, exact match first', async () => {
  const member = await addMember(db);
  await addVehicle(db, member.id, { plate: 'ขข99', province: 'เชียงใหม่' });
  await addVehicle(db, member.id, { plate: 'ขข99', province: 'ขอนแก่น' });
  await addVehicle(db, member.id, { plate: 'ขข990', province: 'ภูเก็ต' });

  const results = await rpc(db, 'gate_lookup', 'ขข99');

  assert.deepEqual(results.map((r) => r.vehicle.province), ['ขอนแก่น', 'เชียงใหม่', 'ภูเก็ต']);
});

test('entry is refused with the reason shown at the gate', async (t) => {
  await t.test('no paid term', async () => {
    const member = await addMember(db);
    const car = await addVehicle(db, member.id);
    assert.match((await lookup(car.plate)).denial, /ยังไม่มีแพ็กเกจ/);
    await assert.rejects(rpc(db, 'check_in', car.id, null), /ยังไม่มีแพ็กเกจ/);
  });

  await t.test('unpaid term', async () => {
    const member = await addMember(db);
    const car = await addVehicle(db, member.id);
    const plan = await addPackage(db);
    await rpc(db, 'subscribe', member.id, plan.id, null, null);
    await assert.rejects(rpc(db, 'check_in', car.id, null), /ยังไม่มีแพ็กเกจ/);
  });

  await t.test('expired term', async () => {
    const { car, term } = await paidMember();
    await db.query(
      `update public.subscriptions set start_date = private.bangkok_today() - 31, end_date = private.bangkok_today() - 1 where id = $1`,
      [term.id],
    );
    await assert.rejects(rpc(db, 'check_in', car.id, null), /หมดอายุ/);
  });

  await t.test('suspended member', async () => {
    const { member, car } = await paidMember();
    await db.query(`update public.members set status = 'suspended' where id = $1`, [member.id]);
    await assert.rejects(rpc(db, 'check_in', car.id, null), /ถูกระงับ/);
  });

  await t.test('outside the package access hours', async () => {
    const { car, plan } = await paidMember();
    await db.query(
      `update public.packages
       set access_start = (now() at time zone 'Asia/Bangkok' + interval '1 hour')::time,
           access_end = (now() at time zone 'Asia/Bangkok' + interval '2 hours')::time
       where id = $1`,
      [plan.id],
    );
    await assert.rejects(rpc(db, 'check_in', car.id, null), /เข้าจอดได้เฉพาะเวลา/);
  });

  await t.test('no free spot', async () => {
    const { car } = await paidMember();
    await db.query(`update public.spots set out_of_service = true where zone_id = $1`, [zone.id]);
    await assert.rejects(rpc(db, 'check_in', car.id, null), /ไม่มีช่องจอดว่าง/);
  });
});

test('access hours that wrap past midnight allow entry inside the window', async () => {
  const { car, plan } = await paidMember();
  await db.query(
    `update public.packages
     set access_start = (now() at time zone 'Asia/Bangkok' - interval '1 minute')::time,
         access_end = (now() at time zone 'Asia/Bangkok' - interval '2 minutes')::time
     where id = $1`,
    [plan.id],
  );

  assert.ok(await rpc(db, 'check_in', car.id, null));
});

test('a package with no zones may use every zone of the right vehicle type', async () => {
  const member = await addMember(db);
  const car = await addVehicle(db, member.id);
  const plan = await addPackage(db);
  await rpc(db, 'subscribe', member.id, plan.id, 'cash', null);

  const status = await lookup(car.plate);

  assert.ok(status.spots.some((s) => Number(s.zone_id) === Number(zone.id)));
});

test('spots outside the package zones or for another vehicle type are not offered', async () => {
  const { car } = await paidMember();
  const other = await addZone(db);
  const bikes = await addZone(db, { vehicleType: 'motorcycle' });

  const { spots } = await lookup(car.plate);
  assert.ok(spots.every((s) => Number(s.zone_id) === Number(zone.id)));

  const forbidden = await value(db, `select id from public.spots where zone_id = $1 limit 1`, [other.id]);
  await assert.rejects(rpc(db, 'check_in', car.id, forbidden), /ไม่อยู่ในสิทธิ์/);

  const bikeSpot = await value(db, `select id from public.spots where zone_id = $1 limit 1`, [bikes.id]);
  await assert.rejects(rpc(db, 'check_in', car.id, bikeSpot), /ไม่อยู่ในสิทธิ์/);
});

test('a car cannot enter twice and a spot cannot hold two cars', async () => {
  const first = await paidMember();
  const second = await paidMember();
  const visit = await rpc(db, 'check_in', first.car.id, null);

  await assert.rejects(rpc(db, 'check_in', first.car.id, null), /อยู่ในลานจอดแล้ว/);
  await assert.rejects(rpc(db, 'check_in', second.car.id, visit.spot_id), /ไม่อยู่ในสิทธิ์/);
  await assert.rejects(
    db.query(
      `insert into public.visits (vehicle_id, member_id, subscription_id, spot_id) values ($1, $2, $3, $4)`,
      [second.car.id, second.member.id, second.term.id, visit.spot_id],
    ),
    /visits_open_spot/,
  );
});

test('a free stay checks out with no payment', async () => {
  const { car } = await paidMember();
  const before = await openVisits(db);
  const visit = await rpc(db, 'check_in', car.id, null);
  await rewindEntry(db, visit.id, 240);

  const done = await rpc(db, 'check_out', visit.id, null, null);

  assert.ok(done.exit_time);
  assert.equal(done.duration_min, 240);
  assert.equal(Number(done.fee), 0);
  assert.equal(done.payment_status, null);
  assert.equal(await openVisits(db), before);
  assert.equal(await value(db, `select count(*)::integer from public.payments where visit_id = $1`, [visit.id]), 0);
});

test('quota is spent across visits and the overage is charged at check-out', async () => {
  const { car } = await paidMember({ pkg: { included_hours: 2, overage_rate: 30 } });

  const first = await rpc(db, 'check_in', car.id, null);
  await rewindEntry(db, first.id, 90);
  assert.equal(Number((await rpc(db, 'check_out', first.id, null, null)).fee), 0);

  const second = await rpc(db, 'check_in', car.id, null);
  await rewindEntry(db, second.id, 91);
  const preview = (await lookup(car.plate)).preview;
  const done = await rpc(db, 'check_out', second.id, 'card', 'POS-7');

  assert.equal(done.chargeable_min, 61);
  assert.equal(Number(done.fee), 60);
  assert.equal(Number(preview.fee), 60);
  assert.equal(done.payment_status, 'paid');
});

test('an unpaid overage stays pending and warns at the next entry without blocking it', async () => {
  const { car } = await paidMember({ pkg: { included_hours: 0, overage_rate: 25 } });
  const visit = await rpc(db, 'check_in', car.id, null);
  await rewindEntry(db, visit.id, 30);

  const done = await rpc(db, 'check_out', visit.id, null, null);
  assert.equal(done.payment_status, 'pending');

  const again = await rpc(db, 'check_in', car.id, null);
  assert.equal(Number(again.outstanding), 25);
});

test('a stay running past expiry is charged, unless a renewal covers it', async () => {
  const { member, car, plan, term } = await paidMember({ pkg: { overage_rate: 20 } });
  const visit = await rpc(db, 'check_in', car.id, null);
  await rewindEntry(db, visit.id, 300);
  await db.query(
    `update public.subscriptions
     set start_date = private.bangkok_today() - 30, end_date = private.bangkok_today() - 1
     where id = $1`,
    [term.id],
  );
  const minutesSinceMidnight = await value(
    db,
    `select ceil(extract(epoch from now() - (private.bangkok_today()::timestamp at time zone 'Asia/Bangkok')) / 60)::integer`,
  );

  const charged = (await lookup(car.plate)).preview;
  assert.ok(Math.abs(charged.chargeable_min - Math.min(300, minutesSinceMidnight)) <= 1);

  await rpc(db, 'subscribe', member.id, plan.id, 'cash', null);
  const covered = await rpc(db, 'check_out', visit.id, null, null);
  assert.equal(Number(covered.fee), 0);
});

test('a suspended member can still leave', async () => {
  const { member, car } = await paidMember();
  const visit = await rpc(db, 'check_in', car.id, null);
  await db.query(`update public.members set status = 'suspended' where id = $1`, [member.id]);

  assert.ok((await rpc(db, 'check_out', visit.id, null, null)).exit_time);
});

test('a visit cannot be checked out twice', async () => {
  const { car } = await paidMember();
  const visit = await rpc(db, 'check_in', car.id, null);
  await rpc(db, 'check_out', visit.id, null, null);

  await assert.rejects(rpc(db, 'check_out', visit.id, null, null), /บันทึกออกไปแล้ว/);
});

test('spot_status shows free, occupied and closed spots', async () => {
  const { car } = await paidMember();
  const visit = await rpc(db, 'check_in', car.id, null);
  const other = await value(
    db, `select id from public.spots where zone_id = $1 and id <> $2`, [zone.id, visit.spot_id],
  );

  let rows = await asStaff(db, `select id, status, plate from public.spot_status where zone_id = $1 order by id`, [zone.id]);
  assert.equal(rows.find((r) => r.id === visit.spot_id).status, 'occupied');
  assert.equal(rows.find((r) => r.id === visit.spot_id).plate, car.plate);
  assert.equal(rows.find((r) => r.id === other).status, 'available');

  await db.query(`update public.spots set out_of_service = true where id = $1`, [other]);
  rows = await asStaff(db, `select id, status from public.spot_status where id = $1`, [other]);
  assert.equal(rows[0].status, 'out_of_service');
});

test('an occupied spot cannot be closed', async () => {
  const { car } = await paidMember();
  const visit = await rpc(db, 'check_in', car.id, null);

  await assert.rejects(
    db.query(`update public.spots set out_of_service = true where id = $1`, [visit.spot_id]),
    /มีรถจอดอยู่/,
  );
});

test('records with history cannot be deleted', async () => {
  const { member, car, plan } = await paidMember();
  const visit = await rpc(db, 'check_in', car.id, null);
  await rpc(db, 'check_out', visit.id, null, null);

  await assert.rejects(asStaff(db, `delete from public.members where id = $1`, [member.id]), /foreign key/);
  await assert.rejects(asStaff(db, `delete from public.vehicles where id = $1`, [car.id]), /foreign key/);
  await assert.rejects(asStaff(db, `delete from public.packages where id = $1`, [plan.id]), /foreign key/);
  await assert.rejects(asStaff(db, `delete from public.zones where id = $1`, [zone.id]), /foreign key/);
});

test('a member with no history can be deleted along with their vehicles', async () => {
  const member = await addMember(db);
  const car = await addVehicle(db, member.id);

  await asStaff(db, `delete from public.members where id = $1`, [member.id]);

  assert.equal(await one(db, `select id from public.vehicles where id = $1`, [car.id]), undefined);
});

test('dashboard_summary adds up the car park', async () => {
  const { car } = await paidMember();
  await rpc(db, 'check_in', car.id, null);

  const summary = await rpc(db, 'dashboard_summary');
  const row = summary.zones.find((z) => Number(z.id) === Number(zone.id));

  assert.equal(row.total, 2);
  assert.equal(row.occupied, 1);
  assert.ok(summary.active_members >= 1);
  assert.ok(summary.entries_today >= 1);
  assert.ok(Number(summary.revenue_today) >= 1000);
});
