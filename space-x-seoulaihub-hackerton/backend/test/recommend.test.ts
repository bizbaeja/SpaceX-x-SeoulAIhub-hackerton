import { describe, expect, it } from 'vitest';
import type { Organization } from '../src/domain.js';
import { recommend } from '../src/recommend.js';

// db/seed.sql 과 같은 구성
const org = (o: Omit<Organization, 'description' | 'services'> & { tags: string[] }): Organization => {
  const { tags, ...rest } = o;
  return { ...rest, description: '', services: [{ id: `${o.id}-s`, name: tags.join('/'), needTags: tags }] };
};
const ORGS: Organization[] = [
  org({ id: 'org-a', name: 'A', region: '강남구', ageMin: 13, ageMax: 24, emergencyCapable: true, availability: 'AVAILABLE', tags: ['심리상담', '위기개입'] }),
  org({ id: 'org-b', name: 'B', region: '강남구', ageMin: 13, ageMax: 18, emergencyCapable: false, availability: 'AVAILABLE', tags: ['학업지원'] }),
  org({ id: 'org-c', name: 'C', region: '서울 전역', ageMin: 9, ageMax: 24, emergencyCapable: true, availability: 'WAITLIST', tags: ['심리상담', '위기개입'] }),
  org({ id: 'org-d', name: 'D', region: '마포구', ageMin: 13, ageMax: 24, emergencyCapable: false, availability: 'AVAILABLE', tags: ['심리상담'] }),
  org({ id: 'org-e', name: 'E', region: '강남구', ageMin: 13, ageMax: 19, emergencyCapable: true, availability: 'AVAILABLE', tags: ['학교적응'] }),
];

describe('기관 추천 (docs 4.6)', () => {
  it('발표 시나리오(13-18·강남구·HIGH·심리상담/학교적응)에서 A가 명확한 1위', () => {
    const { items, excluded } = recommend(ORGS, { ageBand: '13-18', region: '강남구', urgency: 'HIGH', needs: ['심리상담', '학교적응'] });
    expect(items.map((r) => [r.organizationId, r.matchScore])).toEqual([
      ['org-a', 100],
      ['org-e', 90],
      ['org-c', 65],
      ['org-d', 55],
    ]);
    expect(items[0]).toMatchObject({
      name: 'A',
      region: '강남구',
      availability: 'AVAILABLE',
      emergencyCapable: true,
      matchedServices: ['심리상담'],
      matchReasons: ['지역 일치: 강남구', '연령 범위 일치: 13-24', 'need 일치: 심리상담(주요)', '긴급 지원 가능', 'availability: AVAILABLE'],
    });
    expect(items.find((r) => r.organizationId === 'org-c')?.matchReasons).toContain('availability: WAITLIST');
    expect(excluded).toEqual([{ organizationId: 'org-b', name: 'B', reasons: ['need(심리상담, 학교적응) 제공 서비스 없음'] }]);
  });

  it('긴급도가 HIGH가 아니면 긴급 지원 가점이 없다', () => {
    const { items } = recommend(ORGS, { ageBand: '13-18', region: '강남구', urgency: 'MEDIUM', needs: ['심리상담'] });
    expect(items.every((r) => r.scoreBreakdown.emergency === 0)).toBe(true);
  });

  it('연령대가 겹치지 않으면 제외, 일부만 겹치면 부분 점수', () => {
    const { items, excluded } = recommend(ORGS, { ageBand: '19-24', region: '강남구', urgency: 'MEDIUM', needs: ['학교적응'] });
    expect(items).toMatchObject([{ organizationId: 'org-e', scoreBreakdown: { age: 10 } }]);
    expect(excluded.find((e) => e.organizationId === 'org-a')?.reasons).toEqual(['need(학교적응) 제공 서비스 없음']);

    const young = recommend(ORGS, { ageBand: '6-8', region: '강남구', urgency: 'MEDIUM', needs: ['심리상담'] });
    expect(young.items).toEqual([]);
  });
});
