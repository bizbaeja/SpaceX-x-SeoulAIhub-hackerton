import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiService } from '../src/ai/index.js';
import { mockProvider } from '../src/ai/mock.js';
import { createApp } from '../src/app.js';
import { migrate, openDb, type Db } from '../src/db.js';
import { DEMO_NOTE } from '../src/domain.js';
import { getReferralPayload } from '../src/queries.js';
import { mockChatProvider } from '../src/chat/providers.js';
import { createChatService } from '../src/chat/service.js';

const SEED_CASE_1 = '00000000-0000-4000-8000-000000000001';
const SEED_CASE_2 = '00000000-0000-4000-8000-000000000002';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await openDb({}); // 인메모리 PGlite + seed
  await migrate(db);
  app = createApp({ db, ai: createAiService(mockProvider), chat: createChatService(mockChatProvider) });
});
afterAll(async () => {
  await db.close();
});

const errorCode = (code: string) => (res: request.Response) => expect(res.body.error.code).toBe(code);

describe('Case 파트 플로우 (docs 4.1 ~ 4.6)', () => {
  it('생성 → 목록 → 상세 → 구조화 → 확정 → 추천', async () => {
    // 4.1
    const created = await request(app)
      .post('/api/cases')
      .send({ alias: 'student-demo-101', ageBand: '13-18', region: '강남구', consentStatus: 'guardian_pending' })
      .expect(201);
    const id: string = created.body.id;
    expect(created.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      alias: 'student-demo-101',
      ageBand: '13-18',
      region: '강남구',
      consentStatus: 'guardian_pending',
      createdAt: expect.any(String),
    });

    // 4.2
    const list = await request(app).get('/api/cases').expect(200);
    expect(list.body.items.find((c: { id: string }) => c.id === id)).toMatchObject({ hasProfile: false, confirmedUrgency: null });

    // 4.3
    const detail = await request(app).get(`/api/cases/${id}`).expect(200);
    expect(detail.body).toMatchObject({ id, alias: 'student-demo-101', note: null, profile: null });

    // 확정 전 추천 불가
    await request(app).get(`/api/cases/${id}/recommendations`).expect(422).expect(errorCode('CONFIRMATION_REQUIRED'));
    await request(app).post(`/api/cases/${id}/profile/confirm`).send({ confirmedUrgency: 'HIGH' }).expect(422).expect(errorCode('CONFIRMATION_REQUIRED'));

    // 4.4 — AI 제안(HIGH)은 확정이 아니다. 개인정보는 마스킹되어 저장.
    const structured = await request(app)
      .post(`/api/cases/${id}/structure`)
      .send({ note: `${DEMO_NOTE} 보호자 010-1234-5678` })
      .expect(200);
    expect(structured.body).toMatchObject({
      caseId: id,
      provider: 'mock',
      profile: { suggestedUrgency: 'HIGH', confirmedUrgency: null, confirmedAt: null, needs: ['심리상담', '학교적응'] },
    });
    expect(JSON.stringify(structured.body)).not.toContain('010-1234-5678');
    await request(app).get(`/api/cases/${id}/recommendations`).expect(422).expect(errorCode('CONFIRMATION_REQUIRED'));

    const afterStructure = await request(app).get(`/api/cases/${id}`).expect(200);
    expect(afterStructure.body.note).toContain('[전화번호]');

    // 4.5 — 교사 확정 (suggested와 confirmed 분리 저장)
    const confirmed = await request(app)
      .post(`/api/cases/${id}/profile/confirm`)
      .send({ confirmedUrgency: 'HIGH', needs: ['심리상담', '학교적응'], consentStatus: 'guardian_granted' })
      .expect(200);
    expect(confirmed.body).toMatchObject({
      caseId: id,
      consentStatus: 'guardian_granted',
      profile: { suggestedUrgency: 'HIGH', confirmedUrgency: 'HIGH', confirmedAt: expect.any(String) },
    });

    const listAfter = await request(app).get('/api/cases').expect(200);
    expect(listAfter.body.items.find((c: { id: string }) => c.id === id)).toMatchObject({ hasProfile: true, confirmedUrgency: 'HIGH' });

    // 4.6 — 추천 3개 이상, 점수 내림차순, 근거 포함, note 미포함
    const rec = await request(app).get(`/api/cases/${id}/recommendations`).expect(200);
    expect(rec.body.caseId).toBe(id);
    expect(rec.body.items.length).toBeGreaterThanOrEqual(3);
    expect(rec.body.items.map((r: { organizationId: string }) => r.organizationId)).toEqual(['org-a', 'org-e', 'org-c', 'org-d']);
    expect(rec.body.items[0]).toMatchObject({ organizationId: 'org-a', matchScore: 100, matchedServices: ['심리상담'] });
    expect(rec.body.items[0].matchReasons.length).toBeGreaterThan(0);
    expect(JSON.stringify(rec.body)).not.toContain('결석이 늘고');
  });

  it('교사가 AI 제안과 다르게 확정할 수 있고, needs를 조정할 수 있다', async () => {
    const { body } = await request(app).post('/api/cases').send({ ageBand: '16-18', region: '강남구' }).expect(201);
    expect(body.alias).toMatch(/^student-demo-\d{3}$/);
    expect(body.consentStatus).toBe('guardian_pending');
    await request(app).post(`/api/cases/${body.id}/structure`).send({ note: DEMO_NOTE }).expect(200);
    const confirmed = await request(app)
      .post(`/api/cases/${body.id}/profile/confirm`)
      .send({ confirmedUrgency: 'MEDIUM', needs: ['학교적응'] })
      .expect(200);
    expect(confirmed.body.profile).toMatchObject({
      suggestedUrgency: 'HIGH',
      confirmedUrgency: 'MEDIUM',
      needs: ['학교적응'],
      suggestedNeeds: ['심리상담', '학교적응'],
    });
    expect(confirmed.body.consentStatus).toBe('guardian_pending'); // 생략 시 유지

    // 재구조화하면 확정 초기화
    const again = await request(app).post(`/api/cases/${body.id}/structure`).send({ note: '성적이 떨어져 고민이라고 함.' }).expect(200);
    expect(again.body.profile).toMatchObject({ suggestedUrgency: 'MEDIUM', confirmedUrgency: null });
  });

  it('기관 역할에는 note를 주지 않고, 교사 전용 작업은 403', async () => {
    const asOrg = await request(app).get(`/api/cases/${SEED_CASE_2}`).set('X-Demo-Role', 'organization').expect(200);
    expect(asOrg.body).not.toHaveProperty('note');
    expect(asOrg.body.profile.confirmedUrgency).toBe('MEDIUM');

    const asTeacher = await request(app).get(`/api/cases/${SEED_CASE_2}`).set('X-Demo-Role', 'teacher').expect(200);
    expect(asTeacher.body.note).toContain('성적');

    await request(app).post('/api/cases').set('X-Demo-Role', 'organization').send({ ageBand: '13-18', region: '강남구' }).expect(403).expect(errorCode('FORBIDDEN'));
    await request(app).post(`/api/cases/${SEED_CASE_1}/structure`).set('X-Demo-Role', 'organization').send({ note: DEMO_NOTE }).expect(403);
  });
});

describe('Referral 파트 연동 (getReferralPayload)', () => {
  it('확정된 사례는 docs 4.7 payload 형식, 원문 note 없음', async () => {
    const payload = await getReferralPayload(db, SEED_CASE_2);
    expect(payload).toEqual({
      alias: 'student-demo-002',
      ageBand: '13-15',
      region: '강남구',
      summary: expect.any(String),
      confirmedUrgency: 'MEDIUM',
      needs: ['학업지원'],
      consentStatus: 'guardian_granted',
    });
  });

  it('확정 전 사례는 422 CONFIRMATION_REQUIRED', async () => {
    await expect(getReferralPayload(db, SEED_CASE_1)).rejects.toMatchObject({ status: 422, code: 'CONFIRMATION_REQUIRED' });
  });
});

describe('seed / meta', () => {
  it('데모 seed: 기관 5개, 서비스 6개, 사례 2개', async () => {
    const orgs = await request(app).get('/api/organizations').expect(200);
    expect(orgs.body.items).toHaveLength(5);
    expect(orgs.body.items.flatMap((o: { services: unknown[] }) => o.services)).toHaveLength(6);
    const seedCase = await request(app).get(`/api/cases/${SEED_CASE_1}`).expect(200);
    expect(seedCase.body).toMatchObject({ alias: 'student-demo-001', ageBand: '16-18', profile: null });
  });

  it('health / meta', async () => {
    await request(app).get('/api/health').expect(200).expect((r) => expect(r.body).toEqual({ ok: true, db: 'pglite', aiProvider: 'mock', chatProvider: 'mock' }));
    const meta = await request(app).get('/api/meta').expect(200);
    expect(meta.body.regions).toContain('강남구');
    expect(meta.body.demo.caseId).toBe(SEED_CASE_1);
  });
});

describe('입력 검증 / 오류', () => {
  it('잘못된 값은 400 VALIDATION_ERROR (실명 의심 alias 포함)', async () => {
    await request(app).post('/api/cases').send({ ageBand: '열여섯', region: '강남구' }).expect(400).expect(errorCode('VALIDATION_ERROR'));
    await request(app).post('/api/cases').send({ alias: '홍길동', ageBand: '13-18', region: '강남구' }).expect(400).expect(errorCode('VALIDATION_ERROR'));
    await request(app).post('/api/cases').send({ ageBand: '13-18', region: '강남구', consentStatus: 'yes' }).expect(400);
    await request(app).post('/api/cases').set('content-type', 'application/json').send('{bad json').expect(400).expect(errorCode('VALIDATION_ERROR'));
    await request(app).post(`/api/cases/${SEED_CASE_2}/profile/confirm`).send({ confirmedUrgency: 'URGENT' }).expect(400);
    await request(app).get('/api/cases').set('X-Demo-Role', 'admin').expect(200); // 목록은 역할 무관
  });

  it('없는 리소스는 404 NOT_FOUND (uuid 형식이 아니어도 500이 아님)', async () => {
    await request(app).get('/api/cases/nope').expect(404).expect(errorCode('NOT_FOUND'));
    await request(app).get('/api/cases/00000000-0000-4000-8000-00000000ffff').expect(404).expect(errorCode('NOT_FOUND'));
    await request(app).post('/api/cases/nope/structure').send({ note: DEMO_NOTE }).expect(404);
    await request(app).get('/api/unknown').expect(404).expect(errorCode('NOT_FOUND'));
  });
});
