-- Youth Support Hackathon MVP schema (6 tables)

create extension if not exists "pgcrypto";

create table if not exists organizations (
  id text primary key,
  name text not null,
  region text not null,
  age_min int not null,
  age_max int not null,
  emergency_capable boolean not null default false,
  availability text not null check (availability in ('AVAILABLE', 'WAITLIST', 'UNAVAILABLE')),
  created_at timestamptz not null default now()
);

create table if not exists services (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  need_tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  age_band text not null,
  region text not null,
  note text,
  consent_status text not null default 'guardian_pending',
  created_at timestamptz not null default now()
);

create table if not exists case_profiles (
  case_id uuid primary key references cases(id) on delete cascade,
  summary text not null,
  risk_types text[] not null default '{}',
  needs text[] not null default '{}',
  suggested_urgency text not null check (suggested_urgency in ('LOW', 'MEDIUM', 'HIGH')),
  confirmed_urgency text check (confirmed_urgency in ('LOW', 'MEDIUM', 'HIGH')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  organization_id text not null references organizations(id),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'ACCEPTED', 'INFO_REQUIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists referral_logs (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references referrals(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_role text not null check (actor_role in ('teacher', 'organization')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_cases_created_at on cases (created_at desc);
create index if not exists idx_services_org on services (organization_id);
create index if not exists idx_referrals_case on referrals (case_id);
create index if not exists idx_referral_logs_referral on referral_logs (referral_id, created_at);
