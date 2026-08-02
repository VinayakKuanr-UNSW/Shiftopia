-- =====================================================================
-- Standardized Org → Department → Subdepartment → Role framework
-- TRIAL migration — creates everything under a dedicated `hr` schema so it
-- coexists with the existing public.{organizations,departments,sub_departments,
-- remuneration_levels,roles,role_levels} tables WITHOUT collision.
--
-- NOT auto-applied. Do NOT drop this into supabase/migrations/ as-is: that
-- desyncs the reconciled remote migration history (see memory: db-schema
-- reproducible baseline). Apply to a DEV BRANCH first, then promote.
--
-- Forward-only. Postgres 17.
-- =====================================================================

create schema if not exists hr;

-- ========================= ORG HIERARCHY =========================
create table hr.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table hr.departments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references hr.organizations(id) on delete cascade,
  name             text not null,
  code             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name)        -- also indexes organization_id (leading col)
);

create table hr.subdepartments (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null references hr.departments(id) on delete cascade,
  name           text not null,
  code           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (department_id, name)          -- also indexes department_id
);

-- ============ STANDARDIZED REMUNERATION LEVELS (global reference) ============
create table hr.remuneration_levels (
  level_number    smallint primary key check (level_number between 0 and 7),
  level_name      text not null unique,
  hourly_rate_min numeric(10,2) not null,
  hourly_rate_max numeric(10,2) not null,
  salary_min      numeric(12,2),
  salary_max      numeric(12,2),
  description     text,
  check (hourly_rate_max >= hourly_rate_min),
  check (salary_min is null or salary_max is null or salary_max >= salary_min)
);

-- ============================== ROLES ==============================
create table hr.roles (
  id                 uuid primary key default gen_random_uuid(),
  subdepartment_id   uuid     not null references hr.subdepartments(id) on delete cascade,
  remuneration_level smallint not null references hr.remuneration_levels(level_number),
  name               text     not null,
  code               text,
  is_active          boolean  not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (remuneration_level between 0 and 7),          -- defense-in-depth
  unique (subdepartment_id, remuneration_level),        -- at most 1 role per level
  unique (subdepartment_id, name)                       -- no dup role names in a subdept
);

-- ============================ EMPLOYEES ============================
create table hr.employees (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references hr.organizations(id) on delete restrict,
  full_name        text not null,
  email            text unique,
  employment_type  text,                 -- 'permanent' | 'casual' | ...
  hire_date        date not null default current_date,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table hr.employee_assignments (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references hr.employees(id) on delete cascade,
  role_id        uuid not null references hr.roles(id)     on delete restrict,
  effective_from date not null default current_date,
  effective_to   date,                                  -- NULL = current
  change_reason  text not null default 'hire',          -- hire|promotion|transfer|demotion|lateral
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

-- ============================ INDEXES =============================
create index idx_hr_roles_level          on hr.roles(remuneration_level);
create index idx_hr_employees_org        on hr.employees(organization_id);
create index idx_hr_assignments_role     on hr.employee_assignments(role_id);
create index idx_hr_assignments_employee on hr.employee_assignments(employee_id);

-- exactly ONE current assignment per employee
create unique index uq_hr_current_assignment on hr.employee_assignments(employee_id)
  where effective_to is null;

-- ============ COMPLETENESS: auto-seed 8 roles per subdepartment ============
create or replace function hr.seed_subdepartment_roles()
returns trigger language plpgsql as $$
begin
  insert into hr.roles (subdepartment_id, remuneration_level, name)
  select new.id, rl.level_number, new.name || ' — ' || rl.level_name
  from hr.remuneration_levels rl;
  return new;
end $$;

create trigger trg_hr_seed_subdept_roles
after insert on hr.subdepartments
for each row execute function hr.seed_subdepartment_roles();

-- ============================ SEED LEVELS ============================
-- Global, standardized 0–7 (rates sourced from the EA-2025 pay-engine audit).
insert into hr.remuneration_levels
  (level_number, level_name, hourly_rate_min, hourly_rate_max, salary_min, salary_max) values
  (0,'Trainee', 24.96, 31.20,  50000,  55000),
  (1,'Level 1', 25.65, 32.06,  55000,  62000),
  (2,'Level 2', 26.37, 32.96,  62000,  70000),
  (3,'Level 3', 27.23, 34.04,  70000,  80000),
  (4,'Level 4', 28.79, 35.99,  80000,  92000),
  (5,'Level 5', 30.82, 38.52,  92000, 108000),
  (6,'Level 6', 32.82, 41.03, 108000, 128000),
  (7,'Level 7', 34.19, 42.74, 128000, 155000);

-- =============================== RLS ===============================
-- Match the rest of the DB: RLS enabled with authenticated-read policies.
-- (Write policies intentionally omitted — wire to your cert/RBAC model.)
alter table hr.organizations        enable row level security;
alter table hr.departments          enable row level security;
alter table hr.subdepartments       enable row level security;
alter table hr.remuneration_levels  enable row level security;
alter table hr.roles                enable row level security;
alter table hr.employees            enable row level security;
alter table hr.employee_assignments enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','departments','subdepartments',
    'remuneration_levels','roles','employees','employee_assignments'
  ]
  loop
    execute format(
      'create policy %I on hr.%I for select to authenticated using (true)',
      t || '_auth_read', t
    );
  end loop;
end $$;
