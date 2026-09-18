-- 청소년 AI 채팅 + 내부 HIGH 지수 (추가 기능)
-- HIGH 지수는 교사용 API에서만 노출하고, 청소년용 응답에는 절대 포함하지 않는다.

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id) on delete set null,   -- 교사가 연결한 사례 (없으면 익명 대화)
  alias text not null,
  age_band text not null,
  region text not null,
  high_index int not null default 0 check (high_index between 0 and 100),       -- 현재 지수
  peak_high_index int not null default 0 check (peak_high_index between 0 and 100),
  level text not null default 'LOW' check (level in ('LOW', 'MEDIUM', 'HIGH')),
  crisis_flag boolean not null default false,              -- 한 번 켜지면 유지
  risk_types text[] not null default '{}',
  signals text[] not null default '{}',
  rationale text not null default '',
  ai_provider text not null default '',
  alerted_at timestamptz,                                  -- 처음 HIGH에 도달한 시각 (교사 알림)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id integer generated always as identity primary key,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('youth', 'assistant')),
  content text not null,                                   -- 개인정보 마스킹된 내용
  high_index int,                                          -- 청소년 메시지 직후의 지수 (추이 그래프용)
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_idx on chat_messages (session_id, id);
