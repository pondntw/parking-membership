-- Tables, constraints and row-level triggers.

create schema if not exists private;

-- Allowlist of people who may use the system. Having a Supabase Auth account
-- is not enough: anyone can create one if sign-ups are left enabled.
create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default now()
);

create table public.members (
  id bigint generated always as identity primary key,
  code text generated always as ('MB' || lpad(id::text, greatest(4, length(id::text)), '0')) stored,
  full_name text not null check (btrim(full_name) <> ''),
  phone text not null unique check (phone ~ '^0[0-9]{8,9}$'),
  email text,
  address text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

-- The same letters and digits can be issued in different provinces.
create table public.vehicles (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.members (id) on delete cascade,
  plate text not null check (plate <> ''),
  province text not null check (btrim(province) <> ''),
  type text not null check (type in ('car', 'motorcycle')),
  brand text,
  model text,
  color text,
  unique (plate, province)
);

create index vehicles_member on public.vehicles (member_id);

create table public.zones (
  id bigint generated always as identity primary key,
  name text not null unique check (btrim(name) <> ''),
  vehicle_type text not null check (vehicle_type in ('car', 'motorcycle')),
  description text
);

create table public.spots (
  id bigint generated always as identity primary key,
  zone_id bigint not null references public.zones (id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  out_of_service boolean not null default false,
  unique (zone_id, code)
);

-- included_hours null means unlimited. access_start/access_end null means all day.
create table public.packages (
  id bigint generated always as identity primary key,
  name text not null unique check (btrim(name) <> ''),
  price numeric(10, 2) not null check (price >= 0),
  duration_days integer not null check (duration_days > 0),
  max_vehicles integer not null default 1 check (max_vehicles > 0),
  included_hours integer check (included_hours >= 0),
  overage_rate numeric(10, 2) not null default 0 check (overage_rate >= 0),
  access_start time,
  access_end time,
  is_active boolean not null default true,
  check ((access_start is null) = (access_end is null))
);

-- A package with no rows here may use every zone.
create table public.package_zones (
  package_id bigint not null references public.packages (id) on delete cascade,
  zone_id bigint not null references public.zones (id) on delete cascade,
  primary key (package_id, zone_id)
);

create index package_zones_zone on public.package_zones (zone_id);

-- One row per membership term. Price and quota are copied from the package so
-- that editing a package never changes what a member already bought.
create table public.subscriptions (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.members (id),
  package_id bigint not null references public.packages (id),
  kind text not null check (kind in ('new', 'renewal')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  start_date date not null,
  end_date date not null,
  price numeric(10, 2) not null,
  duration_days integer not null,
  included_hours integer,
  overage_rate numeric(10, 2) not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index subscriptions_member on public.subscriptions (member_id, status, end_date);
create index subscriptions_package on public.subscriptions (package_id);
create unique index subscriptions_one_pending on public.subscriptions (member_id) where status = 'pending';

create table public.visits (
  id bigint generated always as identity primary key,
  vehicle_id bigint not null references public.vehicles (id),
  member_id bigint not null references public.members (id),
  subscription_id bigint not null references public.subscriptions (id),
  spot_id bigint not null references public.spots (id),
  entry_time timestamptz not null default now(),
  exit_time timestamptz,
  duration_min integer,
  chargeable_min integer,
  fee numeric(10, 2),
  recorded_by uuid references auth.users (id) on delete set null,
  exit_recorded_by uuid references auth.users (id) on delete set null,
  check (exit_time is null or exit_time >= entry_time)
);

-- A vehicle or spot can only be in one open visit at a time.
create unique index visits_open_vehicle on public.visits (vehicle_id) where exit_time is null;
create unique index visits_open_spot on public.visits (spot_id) where exit_time is null;
create index visits_entry on public.visits (entry_time desc);
create index visits_subscription on public.visits (subscription_id);
create index visits_member on public.visits (member_id);

create table public.payments (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.members (id),
  kind text not null check (kind in ('subscription', 'overage')),
  subscription_id bigint unique references public.subscriptions (id),
  visit_id bigint unique references public.visits (id),
  amount numeric(10, 2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  method text check (method in ('cash', 'transfer', 'card')),
  reference text,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  check ((kind = 'subscription') = (subscription_id is not null)),
  check ((kind = 'overage') = (visit_id is not null)),
  check (status <> 'paid' or (method is not null and paid_at is not null))
);

create index payments_member on public.payments (member_id);
create index payments_status on public.payments (status, created_at desc);
create index payments_paid_at on public.payments (paid_at);

-- Helpers shared by triggers and RPCs. This schema is not exposed by the API.

create function private.normalize_plate(p_plate text)
returns text language sql immutable set search_path = ''
as $$ select upper(regexp_replace(coalesce(p_plate, ''), '[\s-]', '', 'g')) $$;

create function private.bangkok_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

create function private.active_term(p_member_id bigint, p_day date)
returns public.subscriptions language sql stable set search_path = ''
as $$
  select s.* from public.subscriptions s
  where s.member_id = p_member_id and s.status = 'paid'
    and s.start_date <= p_day and s.end_date >= p_day
  order by s.start_date desc
  limit 1
$$;

create function private.vehicles_before_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_term public.subscriptions;
  v_max integer;
begin
  new.plate := private.normalize_plate(new.plate);

  if tg_op = 'INSERT' or new.member_id is distinct from old.member_id then
    perform 1 from public.members where id = new.member_id for update;
    v_term := private.active_term(new.member_id, private.bangkok_today());
    if v_term.id is not null then
      select max_vehicles into v_max from public.packages where id = v_term.package_id;
      if (select count(*) from public.vehicles where member_id = new.member_id) >= v_max then
        raise exception 'แพ็กเกจปัจจุบันลงทะเบียนรถได้ไม่เกิน % คัน', v_max using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger vehicles_before_write
before insert or update on public.vehicles
for each row execute function private.vehicles_before_write();

create function private.spots_before_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.out_of_service and not old.out_of_service
     and exists (select 1 from public.visits where spot_id = new.id and exit_time is null) then
    raise exception 'ช่องจอดนี้มีรถจอดอยู่ ปิดใช้งานไม่ได้' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger spots_before_update
before update on public.spots
for each row execute function private.spots_before_update();
