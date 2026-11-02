import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

// Stands in for what a new Supabase project already has, including its default
// grants: the migrations have to take those away for the access tests to pass.
const SUPABASE_BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

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
