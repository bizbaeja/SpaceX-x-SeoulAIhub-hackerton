# Cursor Hackathon MVP Rule Pack

90분 안에 하나의 end-to-end 데모 플로우를 완성할 때 쓰는 Cursor 프로젝트 규칙 번들이다.

## 목표

다음 세로 슬라이스를 끊기지 않게 동작시키는 것을 최우선으로 한다.

```text
Case 생성
→ 상담 메모 입력
→ AI 구조화 결과
→ 교사 HIGH 확정
→ 기관 추천
→ Referral 생성
→ 기관 ACCEPTED / INFO_REQUIRED
→ Timeline 표시
```

인증·정교한 RLS·실제 NEIS·외부 공공데이터 동기화·완전한 예외처리는 기본 범위 밖이다.

## 복사할 파일

대상 제품 repo 루트에 다음 파일을 복사한다.

```text
AGENTS.md
AGENT_CHECKLIST.md
.cursor/rules/00-mvp-scope.mdc
.cursor/rules/10-implementation-loop.mdc
.cursor/rules/20-youth-data-safety.mdc
```

`AGENTS.md`는 사람이 읽는 프로젝트 전체 계약이고, `.cursor/rules/*.mdc`는 Cursor Agent에 반복 주입할 짧은 실행 규칙이다. 같은 내용을 두 곳에 길게 중복하지 않는다.

## 기본 기술 가정

- Node.js + Express + TypeScript
- Supabase PostgreSQL
- 기존 프론트는 REST API 호출
- 실제 AI 키가 없으면 deterministic mock provider
- 데모 사용자는 고정 ID/role 허용

실제 저장소의 `package.json`, 디렉터리, 실행 명령이 다르면 먼저 그것을 정본으로 사용하고 이 템플릿의 예시는 수정한다.

## 필수 API

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

시간이 부족하면 `request-info`를 빼고 `REQUESTED → ACCEPTED`까지만 완성한다.

## 사용법

첫 프롬프트는 큰 구현 요청 대신 아래처럼 시작한다.

```text
현재 코드베이스를 읽고 이 MVP 플로우를 구현하라.
먼저 관련 구조, 필요한 파일, 변경 순서를 10줄 이내로 요약한 뒤 즉시 구현을 시작하라.
작업은 schema → case → AI/profile → recommendations → referral/timeline 순서로 진행한다.
각 단계가 끝나면 가장 작은 관련 typecheck/build/test를 실행하고 실패하면 다음 단계로 넘어가기 전에 수정한다.
새 기능 추가보다 데모 플로우 완성을 우선한다.
```

에이전트가 멈추지 않도록 로컬 코드 수정·관련 검증은 사전 승인된 것으로 간주하되, commit/push/배포/운영 데이터 변경은 제품 `AGENTS.md`의 권한 표를 따른다.
