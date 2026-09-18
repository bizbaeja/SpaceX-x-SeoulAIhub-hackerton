import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import {
  CONSENT_STATUSES,
  NEEDS,
  REAL_NAME_MESSAGE,
  URGENCIES,
  isRealNameLike,
  iso,
  parseAgeBand,
  toProfile,
  type ProfileRow,
  type Urgency,
} from '../domain.js';
import { HttpError, currentRole, parseBody, requireRole } from '../http.js';
import {
  loadCase,
  loadCaseDetail,
  loadOrganizations,
  loadProfile,
  matchBasis,
  requireConfirmed,
  saveAiProfile,
} from '../queries.js';
import { recommend } from '../recommend.js';

// docs/MVP_SCREEN_AND_API.md 4.1 ~ 4.6

const createCaseSchema = z.object({
  alias: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .refine((v) => !isRealNameLike(v), REAL_NAME_MESSAGE)
    .optional(),
  ageBand: z.string().trim().refine((v) => parseAgeBand(v) !== null, "ageBand는 '13-18' 형식(6~24세)이어야 합니다."),
  region: z.string().trim().min(1).max(20),
  consentStatus: z.enum(CONSENT_STATUSES).default('guardian_pending'),
});

const structureSchema = z.object({
  note: z.string().trim().min(5).max(4000),
});

const confirmSchema = z.object({
  confirmedUrgency: z.enum(URGENCIES),
  /** 생략하면 현재 needs(AI 제안)를 그대로 확정 */
  needs: z.array(z.enum(NEEDS)).min(1).optional(),
  /** 생략하면 기존 동의 상태 유지 */
  consentStatus: z.enum(CONSENT_STATUSES).optional(),
});

export function casesRouter({ db, ai }: AppContext) {
  const router = Router();

  // 4.1 Case 생성
  router.post('/', async (req, res) => {
    const me = requireRole(req, 'teacher');
    const body = parseBody(createCaseSchema, req.body);
    let alias = body.alias;
    if (!alias) {
      const [{ n }] = await db.query<{ n: number }>('select count(*)::int + 1 as n from cases');
      alias = `student-demo-${String(n).padStart(3, '0')}`;
    }
    const [row] = await db.query<{ id: string; created_at: Date }>(
      `insert into cases (alias, age_band, region, consent_status, created_by)
       values ($1, $2, $3, $4, $5) returning id, created_at`,
      [alias, body.ageBand, body.region, body.consentStatus, me.id],
    );
    res.status(201).json({
      id: row.id,
      alias,
      ageBand: body.ageBand,
      region: body.region,
      consentStatus: body.consentStatus,
      createdAt: iso(row.created_at),
    });
  });

  // 4.2 목록
  router.get('/', async (_req, res) => {
    const rows = await db.query<{
      id: string;
      alias: string;
      age_band: string;
      region: string;
      consent_status: string;
      created_at: Date;
      has_profile: boolean;
      suggested_urgency: Urgency | null;
      confirmed_urgency: Urgency | null;
      crisis_flag: boolean | null;
    }>(
      `select c.id, c.alias, c.age_band, c.region, c.consent_status, c.created_at,
              p.case_id is not null as has_profile, p.suggested_urgency, p.confirmed_urgency, p.crisis_flag
         from cases c left join case_profiles p on p.case_id = c.id
        order by c.created_at desc`,
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        alias: r.alias,
        ageBand: r.age_band,
        region: r.region,
        hasProfile: r.has_profile,
        confirmedUrgency: r.confirmed_urgency,
        createdAt: iso(r.created_at),
        // 추가 필드 (배지 표시용)
        suggestedUrgency: r.suggested_urgency,
        crisisFlag: r.crisis_flag === true,
        consentStatus: r.consent_status,
      })),
    });
  });

  // 4.3 상세 (note는 교사에게만)
  router.get('/:id', async (req, res) => {
    res.json(await loadCaseDetail(db, req.params.id, currentRole(req)));
  });

  // 4.4 상담 메모 → AI 구조화. 확정이 아니므로 재실행하면 이전 교사 확정은 초기화된다.
  router.post('/:id/structure', async (req, res) => {
    requireRole(req, 'teacher');
    const { note } = parseBody(structureSchema, req.body);
    const c = await loadCase(db, req.params.id);
    const out = await ai.structure({ note, ageBand: c.age_band, region: c.region });
    const profile = await saveAiProfile(db, c.id, out);
    res.json({
      caseId: c.id,
      profile: toProfile(profile),
      provider: out.provider,
      // 추가 필드: 실제 AI 실패로 mock을 썼을 때의 사유, 소요 시간
      fallbackReason: out.fallbackReason,
      durationMs: out.durationMs,
    });
  });

  // 4.5 교사 확정. AI 제안(suggestedUrgency)과 별도 컬럼(confirmedUrgency)에 저장한다.
  router.post('/:id/profile/confirm', async (req, res) => {
    const me = requireRole(req, 'teacher');
    const body = parseBody(confirmSchema, req.body);
    const c = await loadCase(db, req.params.id);
    const current = await loadProfile(db, c.id);
    if (!current) throw new HttpError(422, 'CONFIRMATION_REQUIRED', '상담 메모를 먼저 구조화하세요.');
    const needs = body.needs ?? current.needs;
    if (needs.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', '지원이 필요한 영역(needs)을 1개 이상 지정하세요.');
    }
    const consentStatus = body.consentStatus ?? c.consent_status;
    const [profile] = await db.query<ProfileRow>(
      `update case_profiles
          set confirmed_urgency = $2, needs = $3::text[], confirmed_by = $4, confirmed_at = now()
        where case_id = $1::uuid
       returning *`,
      [c.id, body.confirmedUrgency, needs, me.id],
    );
    await db.query('update cases set consent_status = $2, updated_at = now() where id = $1::uuid', [c.id, consentStatus]);
    res.json({ caseId: c.id, profile: toProfile(profile), consentStatus });
  });

  // 4.6 기관 추천 (교사 확정 필수)
  router.get('/:id/recommendations', async (req, res) => {
    const c = await loadCase(db, req.params.id);
    const profile = requireConfirmed(await loadProfile(db, c.id));
    const basis = matchBasis(c, profile);
    const { items, excluded } = recommend(await loadOrganizations(db), basis);
    res.json({ caseId: c.id, items, basis, excluded });
  });

  return router;
}
