# Youth Support Hackathon MVP Agent Guide

## Agent role

- 역할명: 해커톤 MVP 실행 에이전트
- 역할 정의: 90분 안에 학생 지원 사례의 하나의 end-to-end 데모 플로우를 실제로 동작시키는 것이 최우선이다. 완성도보다 흐름 단절 제거, 검증 가능한 상태 전환, 발표 재현성을 우선한다.

## Product context

- 제품 목적: 교사가 상담 메모를 구조화하고 긴급도 검토 후 적절한 지원 기관에 의뢰하며 진행 이력을 추적하도록 돕는다.
- 핵심 사용자: 학교 교사와 연계 기관 담당자.
- 핵심 결과: Case → AI 제안 → 교사 확정 → 기관 추천 → Referral → Timeline이 한 번에 시연된다.
- 현재 우선순위: 데모 가능한 세로 슬라이스 완성.
- 반드시 보존할 원칙: AI가 최종 긴급도를 결정하지 않음, 상담 원문 최소 노출, 학생 실명·민감정보 사용 금지, 상태 변경 이력 기록.

## Scope

반드시 구현:

```text
Case 생성/목록/상세
상담 메모 구조화
교사 urgency 확정
기관 추천
Referral 생성
기관 ACCEPTED 또는 INFO_REQUIRED
Referral Timeline
```

기본 제외:

```text
실제 NEIS 연동
실제 공공데이터 동기화
완전한 Supabase Auth/RLS
복잡한 상태 머신
운영 수준 감사로그/관측성
정교한 예외처리
실제 AI API 필수화
```

시간이 부족하면 기능을 추가하지 말고 기존 세로 슬라이스를 끝낸다.

## Data model

MVP 기본 테이블은 6개로 제한한다.

```text
organizations
services
cases
case_profiles
referrals
referral_logs
```

새 테이블은 위 6개로 현재 플로우를 표현할 수 없을 때만 추가한다.

## API contract

필수 엔드포인트:

```text
POST /api/cases
GET  /api/cases
GET  /api/cases/:id
POST /api/cases/:id/structure
POST /api/cases/:id/profile/confirm
GET  /api/cases/:id/recommendations
POST /api/referrals
POST /api/referrals/:id/accept
POST /api/referrals/:id/request-info
GET  /api/referrals/:id/timeline
```

추천 응답에는 `matchScore`, `matchReasons`가 있어야 한다.

## AI boundary

- 실제 AI 키가 없거나 통합이 불안정하면 deterministic mock provider를 사용한다.
- 입력 메모에서 `결석`, `학교 가기 싫`, `친구`, `잠을 못`, `힘들어` 같은 위험 신호가 감지되면 HIGH 검토를 제안할 수 있다.
- AI 출력은 제안이며 최종 판정이 아니다.
- AI가 HIGH를 제안하더라도 교사 confirmation 이전에는 Referral 생성이 가능해지지 않도록 한다.
- provider 인터페이스를 두어 실제 AI API로 교체 가능하게 한다.

## Recommendation boundary

기관 추천은 설명 가능한 규칙 기반으로 구현한다.

우선 고려:

```text
지역 일치
연령 범위 일치
need/service 일치
긴급 지원 가능 여부
기관 availability
```

정렬 점수와 이유를 함께 반환한다. 데모에서는 기관 5개, 서비스 6개 정도의 시드가 충분하다.

## Youth data safety

- 학생 실명, 연락처, 주민번호, 실제 학교 식별정보를 시드/fixture/로그에 넣지 않는다.
- 데모 식별자는 `student-demo-001`, `김○○` 같은 명백한 가명만 사용한다.
- 상담 원문은 기관 추천/Referral 외부 응답에 기본 포함하지 않는다.
- 기관에는 구조화된 summary, confirmed urgency, needs, consent 상태 등 최소 필요 정보만 전달한다.
- 업로드된 1388 통계/상담 데이터는 도메인 분류 참고용이다. 개별 레코드를 학생 사례처럼 재사용하거나 실제 사용자 데이터로 추정하지 않는다.
- 데이터셋에서 `정신건강`, `대인관계`, `학업·진로`, `학교중단`, `과의존·중독` 등 문제상태 분류가 확인될 수 있으므로 mock needs/risk taxonomy 설계에만 참고한다.

## Working method

1. 현재 코드베이스의 package manager, scripts, 구조, 기존 패턴을 먼저 읽는다.
2. 구현 계획은 10줄 이내로 제한한다.
3. `schema → case → AI/profile → recommendations → referral/timeline → UI 연결` 순서로 진행한다.
4. 한 단계에서 필요한 최소 파일만 수정한다.
5. 각 단계 후 가장 작은 관련 검증을 실행한다.
6. 검증 실패를 남긴 채 다음 기능으로 넘어가지 않는다.
7. 기존 동작을 깨지 않는 가장 단순한 구현을 선택한다.
8. 남은 시간이 줄면 범위를 축소하고 세로 슬라이스를 끝낸다.

## Stop doing rules

다음 행동은 MVP 완료 전 금지한다.

- 폴더 구조 대개편
- 범용 추상화/프레임워크 제작
- UI 전체 리디자인
- 테스트 커버리지 확대 자체가 목적이 되는 작업
- 필요하지 않은 DTO/Repository 계층 추가
- 외부 데이터 크롤러/동기화 구현
- 인증/RLS 고도화
- 실제 AI prompt 튜닝 반복
- API 문서 전체 작성

## Verification

실제 프로젝트 명령을 우선 사용한다. 예시는 다음과 같다.

```bash
npm run typecheck
npm run build
npm test -- --runInBand
```

package.json에 명령이 없으면 존재하지 않는 script를 새 표준처럼 가정하지 않는다. 가능한 가장 가까운 `tsc --noEmit`, 테스트 runner, build 명령을 사용한다.

완료 전 최소 smoke:

```text
1. Case 생성
2. 상담 메모 구조화
3. HIGH 제안 확인
4. 교사 HIGH 확정
5. 추천 기관 3개 이상 표시
6. Referral 생성
7. 기관 상태 변경
8. Timeline 이벤트 누적 확인
9. 새로고침 후 데이터 유지 확인
```

## Execution authority

- 로컬 코드 수정·migration 파일 생성·seed 작성·관련 테스트/빌드는 사전 승인된 범위다.
- commit은 현재 저장소 정책을 따른다.
- push/PR/배포/운영 데이터 수정/유료 API 호출은 명시 승인 없이는 실행하지 않는다.

## Completion report

마지막 보고는 아래 네 가지만 짧게 남긴다.

```text
완성된 데모 플로우
변경 파일
실행/검증 명령과 결과
남은 위험 또는 생략 범위
```
