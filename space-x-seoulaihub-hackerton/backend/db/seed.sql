-- 데모 seed. 모든 기관명은 가상이며, 학생 데이터는 명백한 가명만 사용한다.
-- organizations 테이블이 비어 있을 때만 서버 시작 시 1회 실행된다. (npm run db:reset 으로 재생성)

insert into organizations (id, name, region, age_min, age_max, emergency_capable, availability, description) values
  ('org-a', '강남 청소년마음상담센터(데모)', '강남구', 13, 24, true, 'AVAILABLE', '심리상담·위기개입 전문, 긴급 사례 당일 연계'),
  ('org-b', '강남 학습성장센터(데모)', '강남구', 13, 18, false, 'AVAILABLE', '학습코칭·멘토링'),
  ('org-c', '서울 청소년위기지원센터(데모)', '서울 전역', 9, 24, true, 'WAITLIST', '서울 전역 대상 위기상담, 현재 대기자 있음'),
  ('org-d', '마포 청소년상담실(데모)', '마포구', 13, 24, false, 'AVAILABLE', '개인·집단 상담'),
  ('org-e', '강남 학교적응지원센터(데모)', '강남구', 13, 19, true, 'AVAILABLE', '학업중단 예방·학교적응 프로그램');

insert into services (id, organization_id, name, need_tags) values
  ('svc-a1', 'org-a', '개인 심리상담', '{"심리상담"}'),
  ('svc-a2', 'org-a', '위기개입 긴급상담', '{"위기개입","심리상담"}'),
  ('svc-b1', 'org-b', '학습코칭 멘토링', '{"학업지원"}'),
  ('svc-c1', 'org-c', '청소년 위기상담', '{"심리상담","위기개입"}'),
  ('svc-d1', 'org-d', '개인·집단 상담', '{"심리상담"}'),
  ('svc-e1', 'org-e', '학교적응 프로그램', '{"학교적응"}');

-- student-demo-001: 발표 라이브 데모용 (메모 입력 전)
-- student-demo-002: Referral 담당 테스트용 (구조화 + 교사 확정 + 보호자 동의 완료)
insert into cases (id, alias, age_band, region, note, consent_status, created_by, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000000001', 'student-demo-001', '16-18', '강남구', null, 'guardian_pending',
   'demo-teacher-001', now() - interval '1 hour', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000002', 'student-demo-002', '13-15', '강남구',
   '최근 성적이 많이 떨어졌고 수업을 따라가기 어렵다고 함. 시험 기간마다 긴장을 많이 한다고 이야기함.',
   'guardian_granted', 'demo-teacher-001', now() - interval '3 days', now() - interval '3 days');

insert into case_profiles (
  case_id, summary, risk_types, needs, suggested_needs, signals, suggested_urgency, urgency_rationale, crisis_flag,
  ai_provider, structured_at, confirmed_urgency, confirmed_by, confirmed_at
) values (
  '00000000-0000-4000-8000-000000000002',
  '13-15세 학생(강남구). 성적·학업 부담 신호가 관찰됨. 학업·진로 영역 지원 검토 필요.',
  '{"학업·진로"}', '{"학업지원"}', '{"학업지원"}', '{"성적·학업 부담"}',
  'MEDIUM', '위험 신호 1개 영역(학업·진로) 관찰', false,
  'mock', now() - interval '3 days', 'MEDIUM', 'demo-teacher-001', now() - interval '3 days'
);
