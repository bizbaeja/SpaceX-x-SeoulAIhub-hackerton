import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAiService } from '../src/ai/index.js';
import { mockProvider } from '../src/ai/mock.js';
import { createApp } from '../src/app.js';
import {
  buildReplyRequest,
  createGeminiChatProvider,
  mockChatProvider,
  type ChatProvider,
} from '../src/chat/providers.js';
import { CRISIS_LINE, combineAssessment, mergeSessionRisk, ruleAssessment, type SessionRisk } from '../src/chat/risk.js';
import { createChatService } from '../src/chat/service.js';
import { migrate, openDb, type Db } from '../src/db.js';

const DEMO = ['요즘 학교 가기 싫어요.', '친구랑 다툰 뒤로 계속 혼자 있어요.', '잠을 못 자서 너무 힘들어요.'];
const CRISIS = '그냥 다 사라지고 싶다는 생각이 들어요.';
const mock0 = mockChatProvider;
const fast = { smoothDelayMs: 0 };

describe('HIGH 지수 계산', () => {
  it('규칙 하한선: 위험 영역 3개 → 70, 자해·자살 → 90, 신호 없음 → 5', () => {
    expect(ruleAssessment(DEMO).highIndex).toBe(70);
    expect(ruleAssessment([CRISIS]).highIndex).toBe(90);
    expect(ruleAssessment(['오늘 급식 맛있었어요.']).highIndex).toBe(5);
  });

  it('모델이 낮게 봐도 규칙 하한선 아래로 내려가지 않는다', () => {
    const model = { highIndex: 30, riskTypes: [], signals: ['피곤함'], crisisFlag: false, rationale: '경미' };
    const combined = combineAssessment(model, ruleAssessment(DEMO));
    expect(combined.highIndex).toBe(70);
    expect(combined.rationale).toContain('하한 적용');
    expect(combineAssessment(null, ruleAssessment(DEMO)).highIndex).toBe(70);
  });

  it('위기 표시는 유지되고, 첫 HIGH 시각과 최고치를 기억한다', () => {
    const start: SessionRisk = { highIndex: 0, peakHighIndex: 0, level: 'LOW', crisisFlag: false, riskTypes: [], signals: [], rationale: '', alertedAt: null };
    const t1 = new Date('2026-09-18T01:00:00Z');
    const afterCrisis = mergeSessionRisk(start, ruleAssessment([CRISIS]), t1);
    expect(afterCrisis).toMatchObject({ level: 'HIGH', crisisFlag: true, peakHighIndex: 90, alertedAt: t1 });

    // 이후 가벼운 대화가 이어져도 위기 세션은 HIGH 아래로 내려가지 않는다
    const calm = { highIndex: 20, riskTypes: [], signals: [], crisisFlag: false, rationale: '안정' };
    const later = mergeSessionRisk(afterCrisis, calm, new Date('2026-09-18T02:00:00Z'));
    expect(later).toMatchObject({ highIndex: 70, level: 'HIGH', crisisFlag: true, peakHighIndex: 90, alertedAt: t1 });
  });
});

describe('채팅 서비스 (스트리밍)', () => {
  const svc = (p: ChatProvider, fallback: ChatProvider = mock0) => createChatService(p, fallback, fast);
  const streaming = (chunks: string[], opts: { failAfter?: number; assess?: ChatProvider['assess'] } = {}): ChatProvider => ({
    name: 'fake',
    async *streamReply(_input, onModel) {
      onModel?.('fake:model');
      for (let i = 0; i < chunks.length; i++) {
        if (opts.failAfter === i) throw new Error('끊김');
        yield chunks[i];
      }
      if (opts.failAfter === chunks.length) throw new Error('끊김');
    },
    assess: opts.assess ?? (async () => ({ highIndex: 40, riskTypes: ['정신건강'], signals: ['수면'], crisisFlag: false, rationale: '주의' })),
  });

  it('조각을 onDelta로 흘려보내고, 합친 답장을 돌려준다', async () => {
    const deltas: string[] = [];
    const out = await svc(streaming(['잠을 ', '못 자서 ', '힘들었겠어요.'])).reply({
      history: [],
      message: DEMO[2],
      ageBand: '13-18',
      onDelta: (t) => deltas.push(t),
    });
    expect(deltas.join('')).toBe('잠을 못 자서 힘들었겠어요.');
    expect(deltas.every((d) => d.length <= 2)).toBe(true); // 큰 덩어리를 2글자씩 흘려보냄
    expect(out.reply).toBe('잠을 못 자서 힘들었겠어요.');
    expect(out.provider).toBe('fake:model');
    expect(out.turn.highIndex).toBe(40); // 모델 40 vs 규칙 35
  });

  it('첫 글자 전에 실패하면 mock 답장으로 대체, 도중에 끊기면 보낸 데까지 유지', async () => {
    const before = await svc(streaming(['x'], { failAfter: 0 })).reply({ history: [], message: DEMO[0], ageBand: '13-18' });
    expect(before.provider).toBe('mock-fallback');
    expect(before.reply.length).toBeGreaterThan(5);
    expect(before.fallbackReason).toContain('답장: 끊김');

    const mid = await svc(streaming(['조금 ', '더 '], { failAfter: 2 })).reply({ history: [], message: DEMO[0], ageBand: '13-18' });
    expect(mid.reply).toBe('조금 더');
    expect(mid.provider).toBe('fake:model');
  });

  it('평가가 실패해도 규칙 평가로 지수를 낸다', async () => {
    const out = await svc(streaming(['네.'], { assess: async () => { throw new Error('503'); } })).reply({
      history: DEMO.slice(0, 2).map((content) => ({ role: 'youth' as const, content })),
      message: DEMO[2],
      ageBand: '13-18',
    });
    expect(out.turn.highIndex).toBe(70);
    expect(out.fallbackReason).toContain('평가: 503');
  });

  it('위기 메시지면 답장 끝에 109/1388 안내를 이어서 흘려보낸다 (이미 있으면 생략)', async () => {
    const deltas: string[] = [];
    const out = await svc(streaming(['이야기해 줘서 고마워요.'])).reply({
      history: [],
      message: CRISIS,
      ageBand: '13-18',
      onDelta: (t) => deltas.push(t),
    });
    expect(deltas.join('')).toBe(`이야기해 줘서 고마워요.\n\n${CRISIS_LINE}`);
    expect(out.reply).toContain('109');
    expect(out.turn.crisisFlag).toBe(true);

    const already = await svc(streaming(['지금 109에 연락해 볼 수 있어요.'])).reply({ history: [], message: CRISIS, ageBand: '13-18' });
    expect(already.reply).toBe('지금 109에 연락해 볼 수 있어요.');
  });

  it('개인정보는 AI에 보내기 전에 가린다', async () => {
    const seen: string[] = [];
    const spy: ChatProvider = {
      name: 'spy',
      async *streamReply({ history }) {
        seen.push(history.at(-1)!.content);
        yield '네.';
      },
      assess: async () => null,
    };
    const out = await svc(spy).reply({ history: [], message: '제 번호는 010-9876-5432예요', ageBand: '13-18' });
    expect(seen[0]).not.toContain('010-9876-5432');
    expect(out.maskedMessage).toContain('[전화번호]');
  });
});

describe('Gemini 채팅 provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  const sse = (texts: string[]) =>
    new Response(
      new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          for (const t of texts) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`));
          }
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );

  it('streamGenerateContent SSE를 조각으로 읽고, 첫 모델이 404면 다음 모델로 넘어간다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'gone' } }), { status: 404 }))
      .mockResolvedValueOnce(sse(['많이 ', '힘들었겠어요.']));
    vi.stubGlobal('fetch', fetchMock);
    const reply = { apiKey: 'AQ.test', models: ['old', 'gemini-3.6-flash'], timeoutMs: 1000 };
    const provider = createGeminiChatProvider({ reply, assess: reply });

    let used = '';
    const chunks: string[] = [];
    for await (const t of provider.streamReply({ history: [{ role: 'youth', content: DEMO[2] }], ageBand: '13-18' }, (m) => (used = m))) {
      chunks.push(t);
    }
    expect(chunks).toEqual(['많이 ', '힘들었겠어요.']);
    expect(used).toBe('gemini:gemini-3.6-flash');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse');
    expect(init.headers['x-goog-api-key']).toBe('AQ.test');
  });

  it('첫 글자가 제한 시간 안에 안 오면(과부하로 매달림) 다음 모델로 넘어간다', async () => {
    const hanging = (_url: string, init: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
            },
          }),
          { status: 200 },
        ),
      );
    const fetchMock = vi.fn().mockImplementationOnce(hanging).mockResolvedValueOnce(sse(['안녕하세요.']));
    vi.stubGlobal('fetch', fetchMock);
    const reply = { apiKey: 'AQ.test', models: ['slow', 'fast'], timeoutMs: 5000, firstTokenTimeoutMs: 50 };
    const provider = createGeminiChatProvider({ reply, assess: reply });

    const started = Date.now();
    let used = '';
    const chunks: string[] = [];
    for await (const t of provider.streamReply({ history: [{ role: 'youth', content: '안녕' }], ageBand: '13-18' }, (m) => (used = m))) {
      chunks.push(t);
    }
    expect(chunks).toEqual(['안녕하세요.']);
    expect(used).toBe('gemini:fast');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('평가는 JSON 호출로 받아 0~100으로 정규화한다', async () => {
    const body = { highIndex: 140, riskTypes: ['정신건강', '없는분류'], signals: ['수면 문제'], crisisFlag: false, rationale: '근거' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }))),
    );
    const assess = { apiKey: 'AQ.test', models: ['gemini-3.5-flash-lite'], timeoutMs: 1000 };
    const provider = createGeminiChatProvider({ reply: assess, assess });
    expect(await provider.assess({ history: [{ role: 'youth', content: DEMO[2] }], ageBand: '13-18' })).toEqual({
      highIndex: 100,
      riskTypes: ['정신건강'],
      signals: ['수면 문제'],
      crisisFlag: false,
      rationale: '근거',
    });
  });

  it('답장 요청은 첫 인사(assistant)를 빼고 user 차례로 시작한다', () => {
    const req = buildReplyRequest('gemini-3.6-flash', [
      { role: 'assistant', content: '안녕하세요' },
      { role: 'youth', content: '안녕' },
      { role: 'assistant', content: '반가워요' },
      { role: 'youth', content: '힘들어요' },
    ], '13-18');
    expect(req.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(JSON.stringify(req)).not.toMatch(/highIndex|assessment/);
  });
});

describe('채팅 API', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await openDb({});
    await migrate(db);
    app = createApp({ db, ai: createAiService(mockProvider), chat: createChatService(mock0, mock0, fast) });
  });
  afterAll(async () => {
    await db.close();
  });

  const asStudent = (r: request.Test) => r.set('X-Demo-Role', 'student');
  const asTeacher = (r: request.Test) => r.set('X-Demo-Role', 'teacher');
  const parseSse = (text: string) =>
    text
      .split('\n\n')
      .filter(Boolean)
      .map((block) => {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        return { event, data: data ? JSON.parse(data) : null };
      });

  it('청소년 대화 → 교사 HIGH 지수 → 사례로 넘기기 → 기존 확정·추천 플로우', async () => {
    const started = await asStudent(request(app).post('/api/chat/sessions')).send({ ageBand: '16-18', region: '강남구' }).expect(201);
    const sid: string = started.body.sessionId;
    expect(started.body.notice).toContain('선생님께 전달될 수 있어요');
    expect(started.body.messages).toHaveLength(1);

    // 일반 JSON 응답
    const first = await asStudent(request(app).post(`/api/chat/sessions/${sid}/messages`)).send({ content: DEMO[0] }).expect(200);
    expect(first.body.message.role).toBe('assistant');
    expect(first.body.resources).toBeNull();

    // 스트리밍 응답
    const streamed = await asStudent(request(app).post(`/api/chat/sessions/${sid}/messages`))
      .send({ content: DEMO[1], stream: true })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString('utf8')));
        res.on('end', () => cb(null, data));
      })
      .expect(200)
      .expect('content-type', /text\/event-stream/);
    const events = parseSse(streamed.body as string);
    const deltas = events.filter((e) => e.event === 'delta');
    const done = events.find((e) => e.event === 'done');
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((e) => e.data.text).join('')).toBe(done?.data.message.content);

    await asStudent(request(app).post(`/api/chat/sessions/${sid}/messages`)).send({ content: DEMO[2] }).expect(200);
    const crisis = await asStudent(request(app).post(`/api/chat/sessions/${sid}/messages`)).send({ content: CRISIS }).expect(200);
    expect(crisis.body.message.content).toContain('109');
    expect(crisis.body.resources.map((r: { contact: string }) => r.contact)).toContain('1388');

    // 청소년용 응답·대화 기록에는 HIGH 지수가 없다
    const transcript = await asStudent(request(app).get(`/api/chat/sessions/${sid}/messages`)).expect(200);
    expect(transcript.body.items).toHaveLength(9);
    for (const body of [first.body, crisis.body, transcript.body, streamed.body]) {
      expect(JSON.stringify(body)).not.toMatch(/highIndex|high_index|"level"|crisisFlag/);
    }

    // 학생은 교사용 API 불가
    await asStudent(request(app).get('/api/chat/sessions')).expect(403);
    await asStudent(request(app).get(`/api/chat/sessions/${sid}/assessment`)).expect(403);

    // 교사: 목록 맨 위, HIGH + 위기
    const list = await asTeacher(request(app).get('/api/chat/sessions')).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: sid, level: 'HIGH', crisisFlag: true, highIndex: 90, youthMessageCount: 4 });
    expect(list.body.items[0].alertedAt).toEqual(expect.any(String));

    const assessment = await asTeacher(request(app).get(`/api/chat/sessions/${sid}/assessment`)).expect(200);
    expect(assessment.body.trend.map((t: { highIndex: number }) => t.highIndex)).toEqual([35, 50, 70, 90]);
    expect(assessment.body.crisisGuidance).toContain('109');
    expect(assessment.body.riskTypes).toEqual(expect.arrayContaining(['자해·자살위험', '정신건강', '대인관계', '학교중단']));

    // 사례로 넘기기 → AI 제안(HIGH·위기개입), 교사 확정 전에는 추천 불가
    const promoted = await asTeacher(request(app).post(`/api/chat/sessions/${sid}/case`)).expect(201);
    const caseId: string = promoted.body.caseId;
    expect(promoted.body).toMatchObject({ createdCase: true, profile: { suggestedUrgency: 'HIGH', crisisFlag: true, confirmedUrgency: null } });
    expect(promoted.body.profile.needs[0]).toBe('위기개입');
    expect(promoted.body.profile.urgencyRationale).toContain('HIGH 지수 최고 90');
    await request(app).get(`/api/cases/${caseId}/recommendations`).expect(422);

    await asTeacher(request(app).post(`/api/cases/${caseId}/profile/confirm`)).send({ confirmedUrgency: 'HIGH', consentStatus: 'guardian_granted' }).expect(200);
    const rec = await request(app).get(`/api/cases/${caseId}/recommendations`).expect(200);
    expect(rec.body.items[0].organizationId).toBe('org-a'); // 위기개입·심리상담 + 긴급 대응

    // 다시 넘기면 같은 사례를 갱신 (200)
    const again = await asTeacher(request(app).post(`/api/chat/sessions/${sid}/case`)).expect(200);
    expect(again.body).toMatchObject({ caseId, createdCase: false });
  });

  it('사례에서 시작한 대화는 사례 가명·연령대·지역을 이어받는다', async () => {
    const started = await asStudent(request(app).post('/api/chat/sessions'))
      .send({ caseId: '00000000-0000-4000-8000-000000000001' })
      .expect(201);
    expect(started.body.alias).toBe('student-demo-001');
  });

  it('입력 검증 / 없는 세션', async () => {
    await asStudent(request(app).post('/api/chat/sessions')).send({ region: '강남구' }).expect(400);
    await asStudent(request(app).post('/api/chat/sessions')).send({ alias: '홍길동', ageBand: '13-18', region: '강남구' }).expect(400);
    await asStudent(request(app).post('/api/chat/sessions/nope/messages')).send({ content: '안녕' }).expect(404);
    await request(app).post('/api/chat/sessions').set('X-Demo-Role', 'organization').send({ ageBand: '13-18', region: '강남구' }).expect(403);
    const { body } = await asStudent(request(app).post('/api/chat/sessions')).send({ ageBand: '13-18', region: '강남구' }).expect(201);
    await asStudent(request(app).post(`/api/chat/sessions/${body.sessionId}/messages`)).send({ content: '' }).expect(400);
    await asTeacher(request(app).post(`/api/chat/sessions/${body.sessionId}/case`)).expect(409); // 학생 메시지 없음
  });
});
