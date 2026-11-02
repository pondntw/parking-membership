// Demo mode: a fetch that answers the Supabase REST and Auth calls this app makes
// from a Postgres running in the browser. It loads the real migrations and runs
// as a staff user, so the app behaves as it does on Supabase, with no second
// copy of the business rules. Data stays in this browser's IndexedDB.
import { PGlite } from '@electric-sql/pglite';
import seed from '../../supabase/seed.sql?raw';
import bootstrap from './bootstrap.sql?raw';

const migrations = Object.entries(
  import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }),
).sort(([a], [b]) => a.localeCompare(b)).map(([, sql]) => sql);

// The name follows the schema, so a new release can't open an out-of-date copy.
const schemaHash = [bootstrap, ...migrations, seed].join('')
  .split('').reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) | 0, 7) >>> 0;
const DB_NAME = `parking-demo-${schemaHash.toString(36)}`;

const STAFF_ID = '00000000-0000-0000-0000-00000000d3a0';
const STAFF_EMAIL = 'demo@example.com';

async function open() {
  const db = new PGlite(`idb://${DB_NAME}`);
  await db.waitReady;

  const { rows } = await db.query(`select to_regclass('public.staff') is not null as ready`);
  if (!rows[0].ready) {
    await db.transaction(async (tx) => {
      await tx.exec(bootstrap);
      for (const sql of migrations) await tx.exec(sql);
      await tx.exec(seed);
      await tx.query('insert into auth.users (id, email) values ($1, $2)', [STAFF_ID, STAFF_EMAIL]);
      await tx.query(`insert into public.staff (user_id, full_name) values ($1, 'เจ้าหน้าที่ตัวอย่าง')`, [STAFF_ID]);
    });
  }
  return db;
}

let opening;
const getDb = () => {
  opening ??= open();
  return opening;
};

async function asStaff(sql, params = []) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [STAFF_ID]);
    await tx.exec('set local role authenticated');
    return (await tx.query(sql, params)).rows.map((row) => row.r);
  });
}

const CONTROL_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'columns']);

function parseFilters(params) {
  const clauses = [];
  const values = [];

  const clause = (column, op, value) => {
    if (op === 'is') return `"${column}" is null`;
    values.push(value);
    const placeholder = `$${values.length}`;
    return {
      eq: `"${column}"::text = ${placeholder}`,
      gte: `"${column}" >= ${placeholder}::timestamptz`,
      lt: `"${column}" < ${placeholder}::timestamptz`,
      ilike: `"${column}"::text ilike ${placeholder}`,
    }[op];
  };

  const split = (text) => {
    const [first, ...rest] = text.split('.');
    return [first, rest.join('.')];
  };

  for (const [key, raw] of params) {
    if (CONTROL_PARAMS.has(key)) continue;
    if (key === 'or') {
      const parts = raw.slice(1, -1).split(',').map((part) => {
        const [column, rest] = split(part);
        return clause(column, ...split(rest));
      });
      clauses.push(`(${parts.join(' or ')})`);
    } else {
      clauses.push(clause(key, ...split(raw)));
    }
  }
  return { where: clauses.length ? `where ${clauses.join(' and ')}` : '', values };
}

const orderBy = (order) => {
  if (!order) return '';
  const terms = order.split(',').map((term) => {
    const [column, direction] = term.split('.');
    return `"${column}" ${direction === 'desc' ? 'desc' : 'asc'}`;
  });
  return `order by ${terms.join(', ')}`;
};

const PACKAGES_WITH_ZONES = `(
  select p.*, (
    select coalesce(jsonb_agg(jsonb_build_object('zone_id', z.zone_id)), '[]')
    from public.package_zones z where z.package_id = p.id
  ) as package_zones
  from public.packages p
) s`;

async function selectRows(table, url, wantsObject) {
  const { where, values } = parseFilters(url.searchParams);
  const params = url.searchParams;
  const source = params.get('select')?.includes('package_zones') ? PACKAGES_WITH_ZONES : `public.${table} s`;
  const limit = params.get('limit') ? `limit ${Number(params.get('limit'))}` : '';

  const rows = await asStaff(
    `select to_jsonb(t) as r from (select * from ${source} ${where} ${orderBy(params.get('order'))} ${limit}) t`,
    values,
  );
  const [count] = await asStaff(`select count(*)::integer as r from ${source} ${where}`, values);

  return {
    json: wantsObject ? rows[0] : rows,
    headers: { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${count}` },
  };
}

async function writeRows(table, method, url, body) {
  const { where, values } = parseFilters(url.searchParams);
  let statement;
  let params = values;

  if (method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const columns = Object.keys(rows[0]);
    params = [];
    const tuples = rows.map((row) => `(${columns.map((column) => {
      params.push(row[column]);
      return `$${params.length}`;
    }).join(', ')})`);
    statement = `insert into public.${table} (${columns.map((c) => `"${c}"`).join(', ')}) values ${tuples.join(', ')}`;
  } else if (method === 'PATCH') {
    const columns = Object.keys(body);
    const assignments = columns.map((c, i) => `"${c}" = $${values.length + i + 1}`).join(', ');
    params = [...values, ...columns.map((c) => body[c])];
    statement = `update public.${table} set ${assignments} ${where}`;
  } else {
    statement = `delete from public.${table} ${where}`;
  }

  return asStaff(`with changed as (${statement} returning *) select to_jsonb(changed) as r from changed`, params);
}

async function handleRest(request, url) {
  const path = url.pathname.replace('/rest/v1/', '');
  const text = await request.text();
  const body = text ? JSON.parse(text) : {};
  const wantsObject = (request.headers.get('accept') ?? '').includes('vnd.pgrst.object');

  if (path.startsWith('rpc/')) {
    const names = Object.keys(body);
    const args = names.map((name, i) => `${name} => $${i + 1}`).join(', ');
    const [result] = await asStaff(
      `select to_jsonb(public.${path.slice(4)}(${args})) as r`,
      names.map((name) => body[name]),
    );
    return { json: result };
  }

  if (request.method === 'GET') return selectRows(path, url, wantsObject);

  const rows = await writeRows(path, request.method, url, body);
  return { status: request.method === 'POST' ? 201 : 200, json: wantsObject ? rows[0] : rows };
}

const encode = (value) => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');

function demoSession() {
  const expiresIn = 12 * 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const user = {
    id: STAFF_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: STAFF_EMAIL,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  const payload = { sub: STAFF_ID, exp: expiresAt, role: 'authenticated' };

  return {
    access_token: `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.demo`,
    refresh_token: 'demo',
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
    user,
  };
}

function handleAuth(url) {
  if (url.pathname.endsWith('/logout')) return { status: 204 };
  if (url.pathname.endsWith('/user')) return { json: demoSession().user };
  return { json: demoSession() };
}

const respond = ({ status = 200, json, headers = {} }) =>
  new Response(json === undefined ? null : JSON.stringify(json), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export async function mockFetch(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);

  try {
    if (url.pathname.startsWith('/auth/v1/')) return respond(handleAuth(url));
    return respond(await handleRest(request, url));
  } catch (error) {
    return respond({ status: 400, json: { code: error.code, message: error.message } });
  }
}

export async function resetMockData() {
  const db = await getDb();
  await db.close();

  const databases = await indexedDB.databases();
  await Promise.all(databases.filter((d) => d.name?.includes(DB_NAME)).map((d) => new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(d.name);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  })));

  window.location.reload();
}
