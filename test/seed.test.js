import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asStaff, createDb, rpc } from './support/db.js';

let db;
before(async () => {
  db = await createDb();
  await db.exec(readFileSync(join(import.meta.dirname, '..', 'supabase', 'seed.sql'), 'utf8'));
});
after(() => db.close());

test('demo data loads and shows every state the app has to display', async () => {
  const summary = await rpc(db, 'dashboard_summary');
  assert.equal(summary.zones.reduce((sum, z) => sum + z.total, 0), 36);
  assert.equal(summary.zones.reduce((sum, z) => sum + z.occupied, 0), 3);
  assert.equal(summary.zones.reduce((sum, z) => sum + z.out_of_service, 0), 1);
  assert.equal(summary.pending_count, 1);
  assert.equal(summary.active_members, 4);
  assert.equal(summary.expiring.length, 1);

  const states = await asStaff(db, `select state, count(*)::integer as n from public.subscription_status group by state order by state`);
  assert.deepEqual(states.map((s) => [s.state, s.n]), [['active', 4], ['expired', 1], ['pending', 1]]);
});

test('a demo member can be looked up and checked out', async () => {
  const [status] = await rpc(db, 'gate_lookup', '3กค3333');
  assert.ok(status.open_visit);
  assert.ok((await rpc(db, 'check_out', status.open_visit.id, null, null)).exit_time);
});
