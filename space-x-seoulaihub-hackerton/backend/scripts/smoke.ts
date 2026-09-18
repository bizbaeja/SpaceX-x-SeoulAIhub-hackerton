// 실행 중인 서버에 Case 파트 데모 클릭 순서(docs 1장 1~4번)를 그대로 한 번 재현한다.
//   npm run dev  →  (다른 터미널) npm run smoke
import { DEMO_NOTE } from '../src/domain.js';

const BASE = (process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`) + '/api';

// 점검용 스크립트라 응답은 느슨하게(any) 다룬다.
async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-demo-role': 'teacher' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json.error)}`);
  return json;
}

const ok = (step: string, detail: string) => console.log(`✔ ${step} — ${detail}`);

const health = await call('GET', '/health');
ok('0. 서버', `db=${health.db}, ai=${health.aiProvider}`);

const created = await call('POST', '/cases', { ageBand: '13-18', region: '강남구', consentStatus: 'guardian_pending' });
ok('1. Case 생성', `${created.alias} (${created.id})`);

const structured = await call('POST', `/cases/${created.id}/structure`, { note: DEMO_NOTE });
const p = structured.profile;
ok('2. 메모 구조화', `${structured.provider}, ${structured.durationMs}ms${structured.fallbackReason ? ` (대체 사유: ${structured.fallbackReason})` : ''}`);
console.log(`    summary: ${p.summary}`);
console.log(`    riskTypes=${p.riskTypes.join(', ')} / needs=${p.needs.join(', ')} / signals=${p.signals.join(', ')}`);
ok('3. AI 제안', `suggestedUrgency=${p.suggestedUrgency} (${p.urgencyRationale})`);

const confirmed = await call('POST', `/cases/${created.id}/profile/confirm`, {
  confirmedUrgency: 'HIGH',
  consentStatus: 'guardian_granted',
});
ok('3. 교사 확정', `confirmedUrgency=${confirmed.profile.confirmedUrgency}, consent=${confirmed.consentStatus}`);

const rec = await call('GET', `/cases/${created.id}/recommendations`);
if (rec.items.length < 3) throw new Error(`추천 기관이 3개 미만: ${rec.items.length}`);
for (const r of rec.items) console.log(`    #${r.rank} ${r.name} ${r.matchScore}점 — ${r.matchReasons.join(' / ')}`);
ok('4. 기관 추천', `${rec.items.length}개 (제외 ${rec.excluded.length}개)`);

const again = await call('GET', `/cases/${created.id}`);
ok('5. 재조회', `hasNote=${again.note != null}, confirmedUrgency=${again.profile.confirmedUrgency}`);
console.log('\nCase 파트 데모 플로우 재현 성공');
