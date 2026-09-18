import { Router } from 'express';
import type { AppContext } from '../app.js';
import {
  AGE_BAND_OPTIONS,
  CONSENT_STATUSES,
  DEMO_NOTE,
  NEEDS,
  REGION_ALL_SEOUL,
  RISK_TYPES,
  SEOUL_DISTRICTS,
  URGENCIES,
} from '../domain.js';
import { loadOrganizations } from '../queries.js';

export function metaRouter({ db, ai }: AppContext) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, db: db.kind, aiProvider: ai.provider });
  });

  // 프론트 드롭다운/배지용 값 목록
  router.get('/meta', (_req, res) => {
    res.json({
      regions: [...SEOUL_DISTRICTS, REGION_ALL_SEOUL],
      ageBands: AGE_BAND_OPTIONS,
      consentStatuses: CONSENT_STATUSES,
      riskTypes: RISK_TYPES,
      needs: NEEDS,
      urgencies: URGENCIES,
      referralStatuses: ['REQUESTED', 'ACCEPTED', 'INFO_REQUIRED'],
      demo: { caseId: '00000000-0000-4000-8000-000000000001', note: DEMO_NOTE },
    });
  });

  router.get('/organizations', async (_req, res) => {
    res.json({ items: await loadOrganizations(db) });
  });

  return router;
}
