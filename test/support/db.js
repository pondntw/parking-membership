import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(import.meta.dirname, '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

// Includes Supabase's default grants: the migrations have to take those away for
// the access tests to pass.
const SUPABASE_BOOTSTRAP = readFileSync(join(ROOT, 'src', 'mock', 'bootstrap.sql'), 'utf8');

export const STAFF_ID = '00000000-0000-0000-0000-000000000001';
export const OUTSIDER_ID = '00000000-0000-0000-0000-000000000002';

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_BOOTSTRAP);

  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }

  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
    STAFF_ID, 'staff@example.com', OUTSIDER_ID, 'outsider@example.com',
  ]);
  await db.query(`insert into public.staff (user_id, full_name) values ($1, 'เจ้าหน้าที่ทดสอบ')`, [STAFF_ID]);
  return db;
}

async function runAs(db, role, userId, sql, params) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    await tx.exec(`set local role ${role}`);
    return (await tx.query(sql, params)).rows;
  });
}

export const asStaff = (db, sql, params = []) => runAs(db, 'authenticated', STAFF_ID, sql, params);
export const asOutsider = (db, sql, params = []) => runAs(db, 'authenticated', OUTSIDER_ID, sql, params);
export const asAnon = (db, sql, params = []) => runAs(db, 'anon', null, sql, params);

export const rpc = async (db, name, ...args) => {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  // to_jsonb matches PostgREST, which returns composite results as JSON objects.
  const [row] = await asStaff(db, `select to_jsonb(public.${name}(${placeholders})) as result`, args);
  return row.result;
};

// Superuser access, for arranging fixtures and moving time around.
export const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
export const value = async (db, sql, params = []) => Object.values(await one(db, sql, params))[0];
