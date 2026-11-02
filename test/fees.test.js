import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, one } from './support/db.js';

const ENTRY = '2026-11-02T01:00:00Z';
const FAR_FUTURE = '2030-01-01T00:00:00Z';

let db;
before(async () => { db = await createDb(); });
after(() => db.close());

const fee = (exit, { coverageEnd = FAR_FUTURE, includedHours = null, usedMin = 0, rate = 20 } = {}) =>
  one(
    db,
    `select total_min, chargeable_min, fee::float8 as fee
     from private.calc_fee($1::timestamptz, $2::timestamptz, $3::timestamptz, $4::integer, $5::integer, $6::numeric)`,
    [ENTRY, exit, coverageEnd, includedHours, usedMin, rate],
  );

test('an unlimited package never charges while membership covers the stay', async () => {
  assert.deepEqual({ ...(await fee('2026-11-02T09:00:00Z')) }, { total_min: 480, chargeable_min: 0, fee: 0 });
});

test('stays inside the quota are free', async () => {
  const result = await fee('2026-11-02T03:00:00Z', { includedHours: 10, usedMin: 300 });
  assert.equal(result.fee, 0);
});

test('only the minutes over quota are charged, rounded up to whole hours', async () => {
  const result = await fee('2026-11-02T04:00:00Z', { includedHours: 2, usedMin: 0 });
  assert.equal(result.chargeable_min, 60);
  assert.equal(result.fee, 20);

  const rounded = await fee('2026-11-02T03:01:00Z', { includedHours: 2, usedMin: 0 });
  assert.equal(rounded.chargeable_min, 1);
  assert.equal(rounded.fee, 20);
});

test('a quota already used up leaves the whole stay chargeable', async () => {
  const result = await fee('2026-11-02T02:30:00Z', { includedHours: 2, usedMin: 500 });
  assert.equal(result.chargeable_min, 90);
  assert.equal(result.fee, 40);
});

test('time parked after coverage ends is charged even on an unlimited package', async () => {
  const result = await fee('2026-11-02T04:00:00Z', { coverageEnd: '2026-11-02T03:00:00Z' });
  assert.equal(result.total_min, 180);
  assert.equal(result.chargeable_min, 60);
  assert.equal(result.fee, 20);
});

test('a stay that started after coverage ended is entirely chargeable', async () => {
  const result = await fee('2026-11-02T02:00:00Z', { coverageEnd: '2026-11-01T00:00:00Z' });
  assert.equal(result.chargeable_min, 60);
});

test('quota overrun and time after coverage add up', async () => {
  const result = await fee('2026-11-02T05:00:00Z', {
    coverageEnd: '2026-11-02T04:00:00Z', includedHours: 2, usedMin: 0,
  });
  assert.equal(result.chargeable_min, 120);
  assert.equal(result.fee, 40);
});

test('rates with satang are kept to two decimals', async () => {
  const result = await fee('2026-11-02T03:00:00Z', { includedHours: 0, rate: 17.5 });
  assert.equal(result.fee, 35);
});
