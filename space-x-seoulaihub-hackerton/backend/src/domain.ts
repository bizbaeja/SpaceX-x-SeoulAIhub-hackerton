// 도메인 상수/타입과 DB row → API 응답(camelCase) 변환. 응답 형식은 docs/MVP_SCREEN_AND_API.md 기준.
// 위험 분류는 청소년1388 문제상태 분류(정신건강, 대인관계, 학업·진로, 학교중단, 과의존·중독 등)를 참고한 mock taxonomy다.

export const URGENCIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const RISK_TYPES = ['자해·자살위험', '정신건강', '대인관계', '학교중단', '학업·진로', '과의존·중독', '가족'] as const;
export type RiskType = (typeof RISK_TYPES)[number];

// 배열 순서 = 동점일 때의 우선순위
export const NEEDS = ['위기개입', '심리상담', '학교적응', '학업지원', '가족지원', '중독예방'] as const;
export type Need = (typeof NEEDS)[number];

export const RISK_TO_NEED: Record<RiskType, Need> = {
  '자해·자살위험': '위기개입',
  정신건강: '심리상담',
  대인관계: '심리상담',
  학교중단: '학교적응',
  '학업·진로': '학업지원',
  '과의존·중독': '중독예방',
  가족: '가족지원',
};

export const CONSENT_STATUSES = ['guardian_pending', 'guardian_granted', 'guardian_denied'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const AVAILABILITIES = ['AVAILABLE', 'WAITLIST', 'UNAVAILABLE'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const SEOUL_DISTRICTS = [
  '종로구', '중구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구', '노원구', '은평구', '서대문구',
  '마포구', '양천구', '강서구', '구로구', '금천구', '영등포구', '동작구', '관악구', '서초구', '강남구', '송파구', '강동구',
] as const;
export const REGION_ALL_SEOUL = '서울 전역';

export const AGE_BAND_OPTIONS = ['9-12', '13-15', '16-18', '13-18', '19-24'] as const;
export const AGE_BAND_PATTERN = /^(\d{1,2})-(\d{1,2})$/;

/** '13-18' → { min: 13, max: 18 }. 형식이 틀리면 null */
export function parseAgeBand(band: string): { min: number; max: number } | null {
  const m = AGE_BAND_PATTERN.exec(band);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  return min >= 6 && max <= 24 && min <= max ? { min, max } : null;
}

export const CRISIS_GUIDANCE =
  '자해·자살 위험 표현이 감지되었습니다. AI 판단과 관계없이 즉시 학교 위기관리 절차(관리자 보고·보호자 연락)를 진행하고, ' +
  '필요 시 자살예방상담전화 109, 청소년상담 1388, 응급 시 112/119로 연계하세요.';

// docs/MVP_SCREEN_AND_API.md 4.4 예시 메모 (HIGH 재현용)
export const DEMO_NOTE = '요즘 결석이 늘고 학교 가기 싫어한다고 함. 친구랑 다툰 뒤 잠을 못 자고 힘들어함.';

export const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

// ---------- organizations ----------

export interface OrgRow {
  id: string;
  name: string;
  region: string;
  age_min: number;
  age_max: number;
  emergency_capable: boolean;
  availability: Availability;
  description: string;
}
export interface ServiceRow {
  id: string;
  organization_id: string;
  name: string;
  need_tags: string[];
}
export interface Organization {
  id: string;
  name: string;
  region: string;
  ageMin: number;
  ageMax: number;
  emergencyCapable: boolean;
  availability: Availability;
  description: string;
  services: { id: string; name: string; needTags: string[] }[];
}

export function toOrganization(row: OrgRow, services: ServiceRow[]): Organization {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    ageMin: row.age_min,
    ageMax: row.age_max,
    emergencyCapable: row.emergency_capable,
    availability: row.availability,
    description: row.description,
    services: services
      .filter((s) => s.organization_id === row.id)
      .map((s) => ({ id: s.id, name: s.name, needTags: s.need_tags })),
  };
}

// ---------- cases / profiles ----------

export interface CaseRow {
  id: string;
  alias: string;
  age_band: string;
  region: string;
  note: string | null;
  consent_status: ConsentStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}
export interface ProfileRow {
  case_id: string;
  summary: string;
  risk_types: string[];
  needs: string[];
  suggested_needs: string[];
  signals: string[];
  suggested_urgency: Urgency;
  urgency_rationale: string;
  crisis_flag: boolean;
  ai_provider: string;
  structured_at: Date;
  confirmed_urgency: Urgency | null;
  confirmed_by: string | null;
  confirmed_at: Date | null;
}

/** 문서 필드(summary~confirmedAt) + 추가 필드(suggestedNeeds 이후, 화면 근거 표시용) */
export function toProfile(row: ProfileRow) {
  return {
    summary: row.summary,
    riskTypes: row.risk_types,
    needs: row.needs,
    suggestedUrgency: row.suggested_urgency,
    confirmedUrgency: row.confirmed_urgency,
    confirmedAt: iso(row.confirmed_at),
    suggestedNeeds: row.suggested_needs,
    signals: row.signals,
    urgencyRationale: row.urgency_rationale,
    crisisFlag: row.crisis_flag,
    crisisGuidance: row.crisis_flag ? CRISIS_GUIDANCE : null,
    aiProvider: row.ai_provider,
    structuredAt: iso(row.structured_at),
  };
}
