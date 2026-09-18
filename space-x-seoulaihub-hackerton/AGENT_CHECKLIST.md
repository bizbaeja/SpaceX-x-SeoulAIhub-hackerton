# 90-minute Agent Checklist

Cursor Agent가 작업 전·중·후에 확인할 실행 체크리스트다. 체크되지 않은 항목이 생기면 새 기능보다 먼저 해결한다.

## A. 시작 전 — 0~10분

- [ ] 현재 package manager와 `package.json` scripts 확인
- [ ] 기존 frontend/backend 구조 확인
- [ ] Supabase client 또는 DB 접근 방식 확인
- [ ] 데모 세로 슬라이스 8단계를 작업 기준으로 고정
- [ ] 기본 제외 범위 확인: Auth/RLS/NEIS/공공데이터 sync/운영 수준 예외처리
- [ ] 수정할 파일 목록과 순서를 10줄 이내로 작성
- [ ] 실명·실제 학생 개인정보가 seed/fixture에 없는지 확인

### 완료 조건

```text
무엇을 만들지, 무엇을 안 만들지, 어떤 명령으로 검증할지 설명할 수 있다.
```

## B. Schema + Seed — 10~25분

- [ ] migration SQL 생성
- [ ] 테이블을 `organizations`, `services`, `cases`, `case_profiles`, `referrals`, `referral_logs` 중심으로 유지
- [ ] 기관 5개 안팎 seed
- [ ] 서비스 6개 안팎 seed
- [ ] Case 2개 안팎 seed
- [ ] 추천 차이가 분명하도록 지역/연령/need/emergency/availability 값을 다르게 구성
- [ ] 모든 seed 학생 데이터는 가명
- [ ] migration/seed 구문 검증

### 추천용 최소 seed 예

```text
A: 강남구 / 13~24 / 심리상담 / 긴급 가능 / AVAILABLE
B: 강남구 / 13~18 / 학업지원 / 긴급 불가 / AVAILABLE
C: 서울 전역 / 심리상담 / 긴급 가능 / WAITLIST
D: 타 지역 / 심리상담 / AVAILABLE
E: 강남구 / 학교적응 / 긴급 가능 / AVAILABLE
```

## C. Case API — 25~35분

- [ ] `POST /api/cases`
- [ ] `GET /api/cases`
- [ ] `GET /api/cases/:id`
- [ ] 생성 → 목록 → 상세 smoke
- [ ] typecheck 또는 관련 테스트 통과

## D. AI + Teacher Confirmation — 35~45분

- [ ] deterministic mock provider 생성
- [ ] 상담 입력을 summary/riskTypes/needs/suggestedUrgency로 구조화
- [ ] 위험 키워드가 있으면 HIGH 검토 제안 가능
- [ ] AI 결과와 교사 확정 값을 별도 저장
- [ ] HIGH 제안만으로 Referral이 열리지 않음
- [ ] 교사 confirmation 후 다음 단계 가능
- [ ] 상담 원문이 불필요한 API 응답으로 새지 않음
- [ ] 관련 typecheck/test 통과

## E. Recommendation — 45~55분

- [ ] 지역 일치 점수
- [ ] 연령 일치 점수
- [ ] need/service 일치 점수
- [ ] emergency capability 점수
- [ ] availability 반영
- [ ] `matchScore` 반환
- [ ] `matchReasons` 반환
- [ ] 가장 적합한 기관이 위에 정렬되는지 fixture로 확인

## F. Referral + Timeline — 55~65분

- [ ] `POST /api/referrals`
- [ ] 생성 시 `referral_logs` 이벤트 기록
- [ ] `POST /api/referrals/:id/accept`
- [ ] `POST /api/referrals/:id/request-info` 또는 시간 부족 시 생략
- [ ] 모든 상태 변경마다 log 기록
- [ ] `GET /api/referrals/:id/timeline`
- [ ] 상태와 timeline 순서가 일치

## G. Frontend Wiring — 65~75분

- [ ] Case 목록
- [ ] 선택 Case 상세
- [ ] 상담 입력 + AI 분석 카드
- [ ] AI 제안과 교사 확정 값이 시각적으로 구분
- [ ] HIGH 배지 강조
- [ ] 추천 기관 카드에 점수 + 근거 표시
- [ ] Referral 생성 CTA
- [ ] 역할 토글: 교사 / 기관 담당자
- [ ] 기관에서 ACCEPTED 또는 INFO_REQUIRED 실행 가능
- [ ] Timeline 표시

### UI 축소 규칙

화면이 없으면 새 페이지를 여러 개 만들지 말고 한 화면 또는 3-column/stepper 구조로 연결한다.

## H. Demo State — 75~82분

- [ ] 발표용 Case 1개를 확실히 준비
- [ ] 상담 문구가 HIGH 제안을 재현
- [ ] 최종 urgency HIGH로 확정 가능
- [ ] 추천 기관 최소 3개
- [ ] 1위 기관이 명확한 이유를 가짐
- [ ] ACCEPTED 상태 referral 1개 준비 가능
- [ ] 필요하면 INFO_REQUIRED referral도 seed

권장 발표 데이터:

```text
16세 / 강남구 / 심리상담 필요
결석 증가 + 친구관계 갈등 + 수면 어려움
AI suggestedUrgency: HIGH
Teacher confirmedUrgency: HIGH
```

## I. Freeze + Final Verification — 마지막 8~10분

이 구간에서는 새 기능을 추가하지 않는다.

- [ ] API 오류 없음
- [ ] typecheck 통과
- [ ] build 통과
- [ ] Case 생성 가능
- [ ] AI 결과 표시
- [ ] 교사 HIGH 확정
- [ ] 추천 정렬 정상
- [ ] Referral 생성
- [ ] 기관 상태 변경
- [ ] Timeline 누적
- [ ] 새로고침 후 데이터 유지
- [ ] 데모 클릭 순서 1회 재현

## Agent failure triggers

아래 상황이면 즉시 현재 작업을 줄인다.

```text
같은 에러를 2번 이상 추측 수정 중
실제 AI 연동 디버깅이 10분 이상 걸림
Auth/RLS 때문에 핵심 플로우가 멈춤
새 abstraction이 현재 기능보다 커짐
UI 한 화면에 15분 이상 소비
외부 API/데이터 소스 응답을 기다려야 함
```

대응:

```text
실제 AI → deterministic mock
Auth → demo user/role
외부 데이터 → seed
다중 페이지 → single flow screen
INFO_REQUIRED → 시간 부족 시 ACCEPTED만
```

## Definition of Done

다음 8개를 실제로 순서대로 보여줄 수 있으면 MVP 완료다.

- [ ] 사례 한 건 생성
- [ ] 상담 메모 입력
- [ ] AI 분석 카드 표시
- [ ] AI HIGH 검토 제안
- [ ] 교사 HIGH 확정
- [ ] 기관 추천 점수/근거 표시
- [ ] Referral 생성 후 기관 상태 변경
- [ ] Timeline 이력 표시
