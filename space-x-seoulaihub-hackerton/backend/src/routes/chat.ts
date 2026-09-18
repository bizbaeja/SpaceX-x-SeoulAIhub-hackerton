import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { CRISIS_RESOURCES, mergeSessionRisk, type SessionRisk } from '../chat/risk.js';
import type { ChatReplyOutcome } from '../chat/service.js';
import type { Db } from '../db.js';
import {
  CRISIS_GUIDANCE,
  REAL_NAME_MESSAGE,
  URGENCIES,
  isRealNameLike,
  iso,
  parseAgeBand,
  toProfile,
  type Urgency,
} from '../domain.js';
import { HttpError, parseBody, requireRole } from '../http.js';
import { isUuid, loadCase, saveAiProfile } from '../queries.js';

// 청소년 AI 채팅 + 내부 HIGH 지수 (추가 기능)
//   청소년용 (X-Demo-Role: student): 세션 시작, 메시지 전송/조회 — HIGH 지수는 절대 응답에 넣지 않는다.
//   교사용   (X-Demo-Role: teacher): 세션 목록/평가(HIGH 지수·추이·대화), 사례로 넘기기(→ 기존 확정·추천 플로우)

export const CHAT_GREETING = '안녕하세요, 저는 이야기를 들어주는 AI 도우미예요. 요즘 어떻게 지내고 있어요? 편하게 이야기해 줘요.';
export const CHAT_NOTICE =
  '이 대화는 AI와 나누는 대화예요. 이야기 중 안전이 걱정되는 내용이 있으면 학생을 돕기 위해 선생님께 전달될 수 있어요. ' +
  '지금 도움이 급하게 필요하면 109 또는 1388에 바로 연락하세요.';

const startSchema = z.object({
  /** 교사가 만든 사례와 연결할 때 (없으면 익명 대화) */
  caseId: z.string().optional(),
  alias: z.string().trim().min(1).max(30).refine((v) => !isRealNameLike(v), REAL_NAME_MESSAGE).optional(),
  ageBand: z.string().trim().refine((v) => parseAgeBand(v) !== null, "ageBand는 '13-18' 형식(6~24세)이어야 합니다.").optional(),
  region: z.string().trim().min(1).max(20).optional(),
});
const messageSchema = z.object({ content: z.string().trim().min(1).max(1000), stream: z.boolean().optional() });

interface SessionRow {
  id: string;
  case_id: string | null;
  alias: string;
  age_band: string;
  region: string;
  high_index: number;
  peak_high_index: number;
  level: Urgency;
  crisis_flag: boolean;
  risk_types: string[];
  signals: string[];
  rationale: string;
  ai_provider: string;
  alerted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
interface MessageRow {
  id: number;
  role: 'youth' | 'assistant';
  content: string;
  high_index: number | null;
  created_at: Date;
}

async function loadSession(db: Db, id: string): Promise<SessionRow> {
  const [row] = isUuid(id) ? await db.query<SessionRow>('select * from chat_sessions where id = $1::uuid', [id]) : [];
  if (!row) throw new HttpError(404, 'NOT_FOUND', '대화를 찾을 수 없습니다.');
  return row;
}

const loadMessages = (db: Db, sessionId: string) =>
  db.query<MessageRow>('select * from chat_messages where session_id = $1::uuid order by id', [sessionId]);

const toSessionRisk = (s: SessionRow): SessionRisk => ({
  highIndex: s.high_index,
  peakHighIndex: s.peak_high_index,
  level: s.level,
  crisisFlag: s.crisis_flag,
  riskTypes: s.risk_types,
  signals: s.signals,
  rationale: s.rationale,
  alertedAt: s.alerted_at,
});

/** 청소년에게 보이는 메시지 (지수 없음) */
const toChatMessage = (m: MessageRow) => ({ id: m.id, role: m.role, content: m.content, createdAt: iso(m.created_at) });

const maxUrgency = (a: Urgency, b: Urgency): Urgency => (URGENCIES.indexOf(a) >= URGENCIES.indexOf(b) ? a : b);

function openSse(res: Response) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  return {
    send: (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    end: () => res.end(),
  };
}

/** 이번 턴(학생 메시지 + 답장 + 세션 지수)을 저장하고 학생용 응답을 만든다. HIGH 지수는 넣지 않는다. */
async function saveTurn(db: Db, session: SessionRow, out: ChatReplyOutcome) {
  const risk = mergeSessionRisk(toSessionRisk(session), out.turn);
  await db.query(`insert into chat_messages (session_id, role, content, high_index) values ($1::uuid, 'youth', $2, $3)`, [
    session.id,
    out.maskedMessage,
    risk.highIndex,
  ]);
  const [reply] = await db.query<MessageRow>(
    `insert into chat_messages (session_id, role, content) values ($1::uuid, 'assistant', $2) returning *`,
    [session.id, out.reply],
  );
  await db.query(
    `update chat_sessions
        set high_index = $2, peak_high_index = $3, level = $4, crisis_flag = $5, risk_types = $6::text[],
            signals = $7::text[], rationale = $8, ai_provider = $9, alerted_at = $10::timestamptz, updated_at = now()
      where id = $1::uuid`,
    [
      session.id,
      risk.highIndex,
      risk.peakHighIndex,
      risk.level,
      risk.crisisFlag,
      risk.riskTypes,
      risk.signals,
      risk.rationale,
      out.provider,
      risk.alertedAt?.toISOString() ?? null,
    ],
  );
  // 위기 신호가 있었던 대화면 도움 연락처를 함께 준다 (지원 정보이지 지수가 아니다)
  return { message: toChatMessage(reply), resources: risk.crisisFlag ? CRISIS_RESOURCES : null };
}

export function chatRouter({ db, ai, chat }: AppContext) {
  const router = Router();

  // ---------- 청소년용 ----------

  router.post('/sessions', async (req, res) => {
    requireRole(req, 'student', 'teacher');
    const body = parseBody(startSchema, req.body);
    let target: { caseId: string | null; alias: string; ageBand: string; region: string };
    if (body.caseId) {
      const c = await loadCase(db, body.caseId);
      target = { caseId: c.id, alias: c.alias, ageBand: c.age_band, region: c.region };
    } else {
      if (!body.ageBand || !body.region) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'caseId가 없으면 ageBand와 region이 필요합니다.');
      }
      const [{ n }] = await db.query<{ n: number }>('select count(*)::int + 1 as n from chat_sessions');
      target = {
        caseId: null,
        alias: body.alias ?? `student-chat-${String(n).padStart(3, '0')}`,
        ageBand: body.ageBand,
        region: body.region,
      };
    }
    const [session] = await db.query<SessionRow>(
      `insert into chat_sessions (case_id, alias, age_band, region, ai_provider)
       values ($1::uuid, $2, $3, $4, $5) returning *`,
      [target.caseId, target.alias, target.ageBand, target.region, chat.provider],
    );
    const [greeting] = await db.query<MessageRow>(
      `insert into chat_messages (session_id, role, content) values ($1::uuid, 'assistant', $2) returning *`,
      [session.id, CHAT_GREETING],
    );
    res.status(201).json({ sessionId: session.id, alias: session.alias, notice: CHAT_NOTICE, messages: [toChatMessage(greeting)] });
  });

  // stream: true 이면 SSE로 답장을 글자 단위로 흘려보낸다.
  //   event: delta  data: { text }                       ← 답장 조각 (여러 번)
  //   event: done   data: { message, resources }         ← 저장된 답장 전체 + 도움 연락처
  //   event: error  data: { code, message }
  router.post('/sessions/:id/messages', async (req, res) => {
    requireRole(req, 'student', 'teacher');
    const { content, stream } = parseBody(messageSchema, req.body);
    const session = await loadSession(db, req.params.id);
    const history = await loadMessages(db, session.id);

    const sse = stream ? openSse(res) : null;
    try {
      const out = await chat.reply({
        history: history.map((m) => ({ role: m.role, content: m.content })),
        message: content,
        ageBand: session.age_band,
        sessionCrisis: session.crisis_flag,
        onDelta: sse ? (text) => sse.send('delta', { text }) : undefined,
      });
      const result = await saveTurn(db, session, out);
      if (!sse) {
        res.json(result);
        return;
      }
      sse.send('done', result);
      sse.end();
    } catch (err) {
      if (!sse) throw err;
      console.error('[chat] stream error', err instanceof Error ? err.stack : err);
      sse.send('error', { code: 'INTERNAL_ERROR', message: '답장을 만들지 못했어요. 잠시 후 다시 시도해 주세요.' });
      sse.end();
    }
  });

  router.get('/sessions/:id/messages', async (req, res) => {
    requireRole(req, 'student', 'teacher');
    const session = await loadSession(db, req.params.id);
    res.json({ items: (await loadMessages(db, session.id)).map(toChatMessage) });
  });

  // ---------- 교사용 ----------

  router.get('/sessions', async (req, res) => {
    requireRole(req, 'teacher');
    const rows = await db.query<SessionRow & { youth_message_count: number; last_message_at: Date | null }>(
      `select s.*,
              (select count(*)::int from chat_messages m where m.session_id = s.id and m.role = 'youth') as youth_message_count,
              (select max(m.created_at) from chat_messages m where m.session_id = s.id) as last_message_at
         from chat_sessions s
        order by s.crisis_flag desc, s.high_index desc, s.updated_at desc`,
    );
    res.json({
      items: rows.map((s) => ({
        id: s.id,
        alias: s.alias,
        caseId: s.case_id,
        ageBand: s.age_band,
        region: s.region,
        highIndex: s.high_index,
        peakHighIndex: s.peak_high_index,
        level: s.level,
        crisisFlag: s.crisis_flag,
        alertedAt: iso(s.alerted_at),
        youthMessageCount: s.youth_message_count,
        lastMessageAt: iso(s.last_message_at),
        createdAt: iso(s.created_at),
      })),
    });
  });

  router.get('/sessions/:id/assessment', async (req, res) => {
    requireRole(req, 'teacher');
    const s = await loadSession(db, req.params.id);
    const messages = await loadMessages(db, s.id);
    res.json({
      sessionId: s.id,
      caseId: s.case_id,
      alias: s.alias,
      ageBand: s.age_band,
      region: s.region,
      highIndex: s.high_index,
      peakHighIndex: s.peak_high_index,
      level: s.level,
      crisisFlag: s.crisis_flag,
      crisisGuidance: s.crisis_flag ? CRISIS_GUIDANCE : null,
      riskTypes: s.risk_types,
      signals: s.signals,
      rationale: s.rationale,
      aiProvider: s.ai_provider,
      alertedAt: iso(s.alerted_at),
      trend: messages
        .filter((m) => m.role === 'youth')
        .map((m) => ({ messageId: m.id, at: iso(m.created_at), highIndex: m.high_index })),
      transcript: messages.map(toChatMessage),
    });
  });

  // 대화를 사례로 넘긴다: 학생 메시지로 AI 구조화 → 사례 프로필(AI 제안) 저장. 이후 기존 교사 확정 → 추천 플로우.
  router.post('/sessions/:id/case', async (req, res) => {
    const me = requireRole(req, 'teacher');
    const s = await loadSession(db, req.params.id);
    const youth = (await loadMessages(db, s.id)).filter((m) => m.role === 'youth');
    if (youth.length === 0) throw new HttpError(409, 'INVALID_STATE', '학생 메시지가 아직 없습니다.');

    let caseId = s.case_id;
    const createdCase = !caseId;
    if (!caseId) {
      const [c] = await db.query<{ id: string }>(
        'insert into cases (alias, age_band, region, created_by) values ($1, $2, $3, $4) returning id',
        [s.alias, s.age_band, s.region, me.id],
      );
      caseId = c.id;
      await db.query('update chat_sessions set case_id = $2::uuid, updated_at = now() where id = $1::uuid', [s.id, caseId]);
    }

    const note = youth.map((m) => m.content).join('\n').slice(-4000);
    const out = await ai.structure({ note, ageBand: s.age_band, region: s.region });
    // 대화 HIGH 지수가 더 높으면 AI 제안 긴급도를 올린다. (최종 판정은 여전히 교사 확정)
    const profile = await saveAiProfile(db, caseId, {
      ...out,
      profile: {
        ...out.profile,
        suggestedUrgency: maxUrgency(out.profile.suggestedUrgency, s.level),
        crisisFlag: out.profile.crisisFlag || s.crisis_flag,
        urgencyRationale: `${out.profile.urgencyRationale} · AI 대화 HIGH 지수 최고 ${s.peak_high_index}`,
      },
    });
    res.status(createdCase ? 201 : 200).json({
      caseId,
      chatSessionId: s.id,
      createdCase,
      profile: toProfile(profile),
      provider: out.provider,
      fallbackReason: out.fallbackReason,
    });
  });

  return router;
}
