# Backend — Case 파트

`docs/MVP_SCREEN_AND_API.md`의 **4.1 ~ 4.6 (Case 생성·목록·상세, AI 구조화, 교사 확정, 기관 추천)** 구현.
4.7 ~ 4.10 Referral 파트는 담당 팀원이 이 서버에 붙인다 → [Referral 연동](#referral-파트-연동).

Node.js 22.13+ · Express 5 · TypeScript · Postgres(Supabase) 또는 로컬 PGlite · Gemini(없으면 mock)

## 실행

```bash
cd space-x-seoulaihub-hackerton/backend
npm install
cp .env.example .env      # GEMINI_API_KEY 입력 (없으면 mock AI로 동작)
npm run dev               # http://localhost:4000/api
```

첫 실행 시 스키마와 데모 seed(기관 5 · 서비스 6 · 사례 2)가 자동으로 들어간다.
`DATABASE_URL`이 없으면 `.data/pglite`에 로컬 Postgres 파일 DB를 만든다. 서버를 재시작해도 데이터가 유지된다.

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (watch) |
| `npm run typecheck` | 타입 검사 |
| `npm test` | 단위·API 테스트 (인메모리 DB, mock AI) |
| `npm run build` / `npm start` | 빌드 후 실행 |
| `npm run smoke` | 실행 중인 서버에 Case 데모 클릭 순서 1회 재현 (실제 AI 호출) |
| `npm run db:reset` | DB 초기화 + seed 재적재 (서버를 끄고 실행) |

## 환경변수 (`.env`)

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `4000` | |
| `DATABASE_URL` | (없음) | Supabase Postgres 연결 문자열. 없으면 로컬 PGlite |
| `AI_PROVIDER` | 키 있으면 `gemini` | `gemini` \| `mock` |
| `GEMINI_API_KEY` | | Google AI Studio 키 (`AQ.` 형식 → `x-goog-api-key` 헤더로 전송) |
| `GEMINI_MODEL` | `gemini-3.6-flash` | 1순위 모델 |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.5-flash` | 1순위가 404/429/5xx/시간 초과일 때 시도 (쉼표 구분) |
| `GEMINI_TIMEOUT_MS` | `15000` | 모델 1회 호출 제한 시간 |

## AI 구조화 (4.4)

```text
메모 → 전화번호·주민번호·이메일 마스킹 → Gemini(구조화 출력, taxonomy enum 강제)
      → 실패 시 다음 모델 → 모두 실패 시 deterministic mock (fallbackReason에 사유)
      → 자해·자살 표현 규칙 재검사 (모델이 놓쳐도 HIGH + 위기개입 + crisisGuidance)
```

- 긴급도 기준(프롬프트·mock 동일): 자해·자살 / 학대·폭력 의심 / 위험 영역 3개 이상 → HIGH, 1~2개 → MEDIUM, 없음 → LOW
- AI 결과는 **제안**이다. 추천(4.6)과 의뢰(4.7)는 교사 확정(`confirmedUrgency`) 전에는 `422 CONFIRMATION_REQUIRED`
- 저장되는 note는 마스킹된 값이다. 교사 역할의 `GET /api/cases/:id`에서만 반환한다.

## 문서와의 차이 / 추가 사항

기존 필드는 모두 문서 그대로이고, 아래는 **추가**만 했다. (프론트는 무시해도 된다)

| 항목 | 내용 |
|---|---|
| 역할 | `X-Demo-Role: organization`으로 교사 전용 작업(생성·구조화·확정)을 호출하면 `403 FORBIDDEN`. 상세 조회 시 `note` 제외 |
| `consentStatus` | `guardian_pending`(기본) \| `guardian_granted` \| `guardian_denied` |
| `alias` | 생략하면 `student-demo-00N` 자동 생성. 실명처럼 보이는 한글 2~4자(`홍길동`)는 400 |
| 목록 item | `suggestedUrgency`, `crisisFlag`, `consentStatus` |
| profile | `suggestedNeeds`(AI 원래 제안), `signals`, `urgencyRationale`, `crisisFlag`, `crisisGuidance`, `aiProvider`, `structuredAt` |
| structure 응답 | `fallbackReason`(mock 대체 사유), `durationMs` |
| 추천 점수 | 문서 힌트 기준. 동점을 피하려고 need를 **주요 need +25 / 그 외 need +15**로 나눴다. 서울 전역 기관 +15, 연령 일부 겹침 +10을 추가 |
| 추천 제외 | 연령 불일치 · 제공 need 없음 · `UNAVAILABLE` 기관은 `excluded[]`에 사유와 함께 따로 반환 |
| 추천 item | `rank`, `scoreBreakdown` / 응답 최상위 `basis`, `excluded` |
| 기타 API | `GET /api/health`, `GET /api/meta`(드롭다운 값·데모 메모), `GET /api/organizations` |

데모 seed 사례 (uuid 고정):

- `00000000-0000-4000-8000-000000000001`: `student-demo-001`, 16-18, 강남구. 메모 입력 전 상태로, 발표 라이브용
- `00000000-0000-4000-8000-000000000002`: `student-demo-002`, 13-15, 강남구. 확정(MEDIUM)과 보호자 동의까지 끝난 상태로, Referral 테스트용

발표 메모(`GET /api/meta`의 `demo.note`)로 구조화하고 HIGH로 확정하면 추천 순위는 다음과 같다.
**강남 청소년마음상담센터 100 → 강남 학교적응지원센터 90 → 서울 청소년위기지원센터 65 → 마포 청소년상담실 55**

## Referral 파트 연동

1. **라우터**: `src/app.ts`의 주석 위치에 `app.use('/api/referrals', referralsRouter(ctx))`를 추가한다. `ctx.db`로 같은 DB를 쓴다.
2. **테이블**: `db/schema.referrals.sql`(+ 필요하면 `db/seed.referrals.sql`)을 추가하면 서버 시작 시 `schema.sql` 다음에 자동 적용된다.
   `cases.id`는 **uuid**이므로 `case_id uuid not null references cases(id)`를 쓴다.
3. **확정 게이트 + payload**: `getReferralPayload(db, caseId)` (`src/queries.ts`)
   - 문서 4.7의 `payload` 형식(`alias, ageBand, region, summary, confirmedUrgency, needs, consentStatus`)을 돌려준다. note는 없다.
   - 교사 확정 전이면 `HttpError(422, 'CONFIRMATION_REQUIRED')`를 던진다. 라우트에서 그대로 throw하면 에러 형식이 맞춰진다.
   - 없는 사례면 `404 NOT_FOUND`.
4. **역할**: `requireRole(req, 'organization')` (`src/http.ts`). 이 함수가 `demo-org-staff-001` 행위자 ID를 돌려준다.
5. **에러**: `throw new HttpError(409, 'INVALID_STATE', '...')`를 쓰면 공통 에러 형식으로 응답된다.

## Supabase로 전환

`DATABASE_URL`에 Supabase 연결 문자열을 넣으면 `db/*.sql`이 자동 적용된다. SQL Editor에 `db/schema.sql`과 `db/seed.sql`을 직접 붙여넣어도 된다.
원격 DB에서 `npm run db:reset`은 `-- --force` 없이는 실행되지 않는다.
