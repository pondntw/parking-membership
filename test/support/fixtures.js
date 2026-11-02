import { one, value } from './db.js';

let counter = 0;

export async function addMember(db, { status = 'active' } = {}) {
  counter += 1;
  return one(
    db,
    `insert into public.members (full_name, phone, status) values ($1, $2, $3) returning *`,
    [`สมาชิก ${counter}`, `08${String(counter).padStart(8, '0')}`, status],
  );
}

export async function addVehicle(db, memberId, { plate, province = 'กรุงเทพมหานคร', type = 'car' } = {}) {
  counter += 1;
  return one(
    db,
    `insert into public.vehicles (member_id, plate, province, type) values ($1, $2, $3, $4) returning *`,
    [memberId, plate ?? `กก${counter}`, province, type],
  );
}

export async function addZone(db, { vehicleType = 'car', spots = 2 } = {}) {
  counter += 1;
  const zone = await one(
    db,
    `insert into public.zones (name, vehicle_type) values ($1, $2) returning *`,
    [`โซน ${counter}`, vehicleType],
  );
  for (let i = 1; i <= spots; i += 1) {
    await db.query(`insert into public.spots (zone_id, code) values ($1, $2)`, [zone.id, `S-${i}`]);
  }
  return zone;
}

export async function addPackage(db, overrides = {}) {
  counter += 1;
  const pkg = {
    name: `แพ็กเกจ ${counter}`,
    price: 1000,
    duration_days: 30,
    max_vehicles: 2,
    included_hours: null,
    overage_rate: 20,
    ...overrides,
  };
  return one(
    db,
    `insert into public.packages (name, price, duration_days, max_vehicles, included_hours, overage_rate)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [pkg.name, pkg.price, pkg.duration_days, pkg.max_vehicles, pkg.included_hours, pkg.overage_rate],
  );
}

export const allowZones = (db, packageId, ...zoneIds) =>
  Promise.all(zoneIds.map((zoneId) =>
    db.query(`insert into public.package_zones (package_id, zone_id) values ($1, $2)`, [packageId, zoneId])));

export const today = (db) => value(db, `select to_char(private.bangkok_today(), 'YYYY-MM-DD')`);

export const dateOffset = (db, days) =>
  value(db, `select to_char(private.bangkok_today() + $1::integer, 'YYYY-MM-DD')`, [days]);

// Rewinds a stay so that a check-out now sees it as `minutes` long. Durations
// round up, so the 30 seconds absorb the time the test itself takes to run.
export const rewindEntry = (db, visitId, minutes) =>
  db.query(
    `update public.visits set entry_time = now() - make_interval(mins => $2) + interval '30 seconds' where id = $1`,
    [visitId, minutes],
  );

export const openVisits = (db) => value(db, `select count(*)::integer from public.visits where exit_time is null`);
