import { REGION_ALL_SEOUL, parseAgeBand, type Organization, type Urgency } from './domain.js';

// 설명 가능한 규칙 기반 추천 (docs 4.6 점수 힌트 기준, 최대 100점)
//   지역   +30 (같은 구) / +15 (서울 전역 기관) / 0
//   연령   +20 (ageBand가 기관 대상 연령 안) / +10 (일부 겹침) / 겹치지 않으면 제외
//   need   +25 (주요 need 일치) / +15 (그 외 need만 일치) / 하나도 안 맞으면 제외
//   긴급   +15 (확정 긴급도 HIGH이고 긴급 지원 가능할 때만)
//   가용성 +10 AVAILABLE / -10 WAITLIST / UNAVAILABLE 제외
export const WEIGHTS = {
  region: 30,
  regionAllSeoul: 15,
  age: 20,
  agePartial: 10,
  primaryNeed: 25,
  otherNeed: 15,
  emergency: 15,
  available: 10,
  waitlist: -10,
} as const;

export interface MatchBasis {
  ageBand: string;
  region: string;
  urgency: Urgency;
  /** 우선순위 순서 (0번이 주요 need) */
  needs: string[];
}

export interface Evaluation {
  eligible: boolean;
  matchScore: number;
  matchReasons: string[];
  scoreBreakdown: { region: number; age: number; need: number; emergency: number; availability: number };
  matchedServices: string[];
  exclusionReasons: string[];
}

export function evaluate(org: Organization, basis: MatchBasis): Evaluation {
  const reasons: string[] = [];
  const exclusions: string[] = [];
  const orgAges = `${org.ageMin}-${org.ageMax}`;

  let region = 0;
  if (org.region === basis.region) {
    region = WEIGHTS.region;
    reasons.push(`지역 일치: ${org.region}`);
  } else if (org.region === REGION_ALL_SEOUL) {
    region = WEIGHTS.regionAllSeoul;
    reasons.push(`광역 기관: ${org.region}`);
  } else {
    reasons.push(`지역 불일치: ${org.region}`);
  }

  let age = 0;
  const band = parseAgeBand(basis.ageBand);
  if (band && band.min >= org.ageMin && band.max <= org.ageMax) {
    age = WEIGHTS.age;
    reasons.push(`연령 범위 일치: ${orgAges}`);
  } else if (band && band.min <= org.ageMax && band.max >= org.ageMin) {
    age = WEIGHTS.agePartial;
    reasons.push(`연령 범위 일부 일치: ${orgAges}`);
  } else {
    exclusions.push(`대상 연령(${orgAges}) 불일치`);
  }

  const tags = new Set(org.services.flatMap((s) => s.needTags));
  const matchedServices = basis.needs.filter((n) => tags.has(n));
  let need = 0;
  if (matchedServices.length === 0) {
    exclusions.push(`need(${basis.needs.join(', ') || '없음'}) 제공 서비스 없음`);
  } else {
    const primaryMatched = matchedServices.includes(basis.needs[0]);
    need = primaryMatched ? WEIGHTS.primaryNeed : WEIGHTS.otherNeed;
    reasons.push(`need 일치: ${matchedServices.map((n) => (n === basis.needs[0] ? `${n}(주요)` : n)).join(', ')}`);
  }

  let emergency = 0;
  if (basis.urgency === 'HIGH') {
    if (org.emergencyCapable) {
      emergency = WEIGHTS.emergency;
      reasons.push('긴급 지원 가능');
    } else {
      reasons.push('긴급 지원 불가');
    }
  }

  let availability = 0;
  if (org.availability === 'UNAVAILABLE') {
    exclusions.push('availability: UNAVAILABLE');
  } else {
    availability = org.availability === 'AVAILABLE' ? WEIGHTS.available : WEIGHTS.waitlist;
    reasons.push(`availability: ${org.availability}`);
  }

  return {
    eligible: exclusions.length === 0,
    matchScore: region + age + need + emergency + availability,
    matchReasons: reasons,
    scoreBreakdown: { region, age, need, emergency, availability },
    matchedServices,
    exclusionReasons: exclusions,
  };
}

/** docs 4.6 items 형식 + rank/scoreBreakdown(추가). 제외된 기관은 excluded로 사유와 함께 돌려준다. */
export function recommend(orgs: Organization[], basis: MatchBasis) {
  const evaluated = orgs.map((org) => ({ org, ev: evaluate(org, basis) }));
  const ranked = evaluated
    .filter(({ ev }) => ev.eligible)
    .sort((a, b) => b.ev.matchScore - a.ev.matchScore || a.org.name.localeCompare(b.org.name, 'ko'));
  return {
    items: ranked.map(({ org, ev }, i) => ({
      organizationId: org.id,
      name: org.name,
      region: org.region,
      availability: org.availability,
      emergencyCapable: org.emergencyCapable,
      matchedServices: ev.matchedServices,
      matchScore: ev.matchScore,
      matchReasons: ev.matchReasons,
      rank: i + 1,
      scoreBreakdown: ev.scoreBreakdown,
    })),
    excluded: evaluated
      .filter(({ ev }) => !ev.eligible)
      .map(({ org, ev }) => ({ organizationId: org.id, name: org.name, reasons: ev.exclusionReasons })),
  };
}
