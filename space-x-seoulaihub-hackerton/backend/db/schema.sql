-- Youth Support MVP schema — Case 파트 (docs/MVP_SCREEN_AND_API.md 3장 기준)
-- Postgres 공통 SQL: 로컬 PGlite, Supabase(SQL Editor에 그대로 붙여넣기) 모두 동일하게 동작한다.
-- referrals / referral_logs 테이블은 Referral 담당이 추가한다. (cases.id 는 uuid)

create table if not exists organizations (
  id text primary key,
  name text not null,
  region text not null,                      -- '강남구' 같은 자치구 또는 '서울 전역'
  age_min int not null,
  age_max int not null,
  emergency_capable boolean not null default false,
  availability text not null default 'AVAILABLE'
    check (availability in ('AVAILABLE', 'WAITLIST', 'UNAVAILABLE')),
  description text not null default ''
);

create table if not exists services (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  name text not null,
  need_tags text[] not null default '{}'     -- 심리상담 / 학교적응 / 학업지원 / 위기개입 / 가족지원 / 중독예방
);

create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  alias text not null,                       -- 가명 (student-demo-001, 김○○)
  age_band text not null,                    -- '13-18'
  region text not null,
  note text,                                 -- 교사 전용. 개인정보 마스킹된 상담 메모
  consent_status text not null default 'guardian_pending'
    check (consent_status in ('guardian_pending', 'guardian_granted', 'guardian_denied')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- AI 제안(suggested_*)과 교사 확정(confirmed_*)을 분리 저장한다.
create table if not exists case_profiles (
  case_id uuid primary key references cases(id) on delete cascade,
  summary text not null,
  risk_types text[] not null default '{}',
  needs text[] not null default '{}',        -- 현재 needs (교사 확정 시 교사 값으로 갱신)
  suggested_needs text[] not null default '{}', -- AI가 처음 제안한 needs
  signals text[] not null default '{}',
  suggested_urgency text not null check (suggested_urgency in ('LOW', 'MEDIUM', 'HIGH')),
  urgency_rationale text not null default '',
  crisis_flag boolean not null default false,
  ai_provider text not null,
  structured_at timestamptz not null default now(),
  confirmed_urgency text check (confirmed_urgency in ('LOW', 'MEDIUM', 'HIGH')),
  confirmed_by text,
  confirmed_at timestamptz
);
