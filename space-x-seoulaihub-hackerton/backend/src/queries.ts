import type { Db } from './db.js';
import {
  iso,
  toOrganization,
  toProfile,
  type CaseRow,
  type OrgRow,
  type ProfileRow,
  type ServiceRow,
  type Urgency,
} from './domain.js';
import { HttpError, type Role } from './http.js';
import type { StructureOutcome } from './ai/index.js';
import type { MatchBasis } from './recommend.js';

// Case 파트 공용 조회. Referral 파트도 loadCase / getReferralPayload 를 그대로 가져다 쓸 수 있다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (id: string) => UUID.test(id);

export async function loadCase(db: Db, id: string): Promise<CaseRow> {
  // uuid 형식이 아니면 DB 캐스팅 오류(500) 대신 404
  const [row] = isUuid(id) ? await db.query<CaseRow>('select * from cases where id = $1::uuid', [id]) : [];
  if (!row) throw new HttpError(404, 'NOT_FOUND', '사례를 찾을 수 없습니다.');
  return row;
}

export async function loadProfile(db: Db, caseId: string): Promise<ProfileRow | null> {
  const [row] = await db.query<ProfileRow>('select * from case_profiles where case_id = $1::uuid', [caseId]);
  return row ?? null;
}

export async function loadOrganizations(db: Db) {
  const [orgs, services] = await Promise.all([
    db.query<OrgRow>('select * from organizations order by id'),
    db.query<ServiceRow>('select * from services order by id'),
  ]);
  return orgs.map((o) => toOrganization(o, services));
}

/** GET /api/cases/:id 응답. note는 교사 전용 — 기관 역할이면 뺀다. */
export async function loadCaseDetail(db: Db, id: string, role: Role = 'teacher') {
  const row = await loadCase(db, id);
  const profile = await loadProfile(db, id);
  return {
    id: row.id,
    alias: row.alias,
    ageBand: row.age_band,
    region: row.region,
    consentStatus: row.consent_status,
    ...(role === 'teacher' ? { note: row.note } : {}),
    profile: profile ? toProfile(profile) : null,
    createdAt: iso(row.created_at),
  };
}

export type ConfirmedProfile = ProfileRow & { confirmed_urgency: Urgency };

/**
 * AI 구조화 결과를 사례에 저장한다. (마스킹된 note + AI 제안 profile)
 * AI 제안은 확정이 아니므로 기존 교사 확정은 초기화된다.
 */
export async function saveAiProfile(
  db: Db,
  caseId: string,
  out: Pick<StructureOutcome, 'maskedNote' | 'profile' | 'provider'>,
): Promise<ProfileRow> {
  const p = out.profile;
  await db.query('update cases set note = $2, updated_at = now() where id = $1::uuid', [caseId, out.maskedNote]);
  const [row] = await db.query<ProfileRow>(
    `insert into case_profiles
       (case_id, summary, risk_types, needs, suggested_needs, signals, suggested_urgency, urgency_rationale, crisis_flag, ai_provider)
     values ($1::uuid, $2, $3::text[], $4::text[], $4::text[], $5::text[], $6, $7, $8, $9)
     on conflict (case_id) do update set
       summary = excluded.summary, risk_types = excluded.risk_types, needs = excluded.needs,
       suggested_needs = excluded.suggested_needs, signals = excluded.signals,
       suggested_urgency = excluded.suggested_urgency, urgency_rationale = excluded.urgency_rationale,
       crisis_flag = excluded.crisis_flag, ai_provider = excluded.ai_provider, structured_at = now(),
       confirmed_urgency = null, confirmed_by = null, confirmed_at = null
     returning *`,
    [caseId, p.summary, p.riskTypes, p.needs, p.signals, p.suggestedUrgency, p.urgencyRationale, p.crisisFlag, out.provider],
  );
  return row;
}

/** 교사 확정 게이트. AI 제안(suggestedUrgency)만으로는 추천/의뢰로 넘어갈 수 없다. */
export function requireConfirmed(profile: ProfileRow | null): ConfirmedProfile {
  if (!profile) throw new HttpError(422, 'CONFIRMATION_REQUIRED', '상담 메모를 먼저 구조화하세요.');
  if (!profile.confirmed_urgency) {
    throw new HttpError(422, 'CONFIRMATION_REQUIRED', 'AI 제안은 최종 판정이 아닙니다. 교사가 긴급도를 먼저 확정하세요.');
  }
  return profile as ConfirmedProfile;
}

export function matchBasis(caseRow: CaseRow, profile: ConfirmedProfile): MatchBasis {
  return { ageBand: caseRow.age_band, region: caseRow.region, urgency: profile.confirmed_urgency, needs: profile.needs };
}

/**
 * Referral 파트 연동용 (docs 4.7 `payload`).
 * 교사 확정이 없으면 422 CONFIRMATION_REQUIRED 를 던진다. 상담 원문(note)은 포함하지 않는다.
 */
export async function getReferralPayload(db: Db, caseId: string) {
  const row = await loadCase(db, caseId);
  const profile = requireConfirmed(await loadProfile(db, caseId));
  return {
    alias: row.alias,
    ageBand: row.age_band,
    region: row.region,
    summary: profile.summary,
    confirmedUrgency: profile.confirmed_urgency,
    needs: profile.needs,
    consentStatus: row.consent_status,
  };
}
