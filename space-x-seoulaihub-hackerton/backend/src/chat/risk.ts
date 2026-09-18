import { detectSignals } from '../ai/mock.js';
import type { RiskType, Urgency } from '../domain.js';

// HIGH 지수(0~100): 청소년과의 대화 전체를 기준으로 한 내부 위험 지수.
//   70 이상 HIGH / 40 이상 MEDIUM / 그 미만 LOW
// 최종 지수 = max(모델 평가, 규칙 하한선). 규칙 하한선이 있어 모델이 위험 신호를 놓쳐도 지수가 내려가지 않는다.

export const HIGH_THRESHOLD = 70;
export const MEDIUM_THRESHOLD = 40;

export const levelOf = (index: number): Urgency =>
  index >= HIGH_THRESHOLD ? 'HIGH' : index >= MEDIUM_THRESHOLD ? 'MEDIUM' : 'LOW';

export interface TurnAssessment {
  highIndex: number;
  riskTypes: RiskType[];
  signals: string[];
  crisisFlag: boolean;
  rationale: string;
}

/** 청소년 메시지 전체에 대한 규칙 기반 하한선 */
export function ruleAssessment(youthMessages: string[]): TurnAssessment {
  const { riskTypes, signals, crisisFlag, escalated } = detectSignals(youthMessages.join('\n'));
  let highIndex: number;
  let rationale: string;
  if (crisisFlag) {
    highIndex = 90;
    rationale = '자해·자살 관련 표현';
  } else if (escalated) {
    highIndex = 80;
    rationale = '가정폭력·학대 의심 표현';
  } else if (riskTypes.length >= 3) {
    highIndex = 70;
    rationale = `위험 영역 ${riskTypes.length}개 동시 관찰`;
  } else if (riskTypes.length === 2) {
    highIndex = 50;
    rationale = '위험 영역 2개 관찰';
  } else if (riskTypes.length === 1) {
    highIndex = 35;
    rationale = '위험 영역 1개 관찰';
  } else {
    highIndex = 5;
    rationale = '뚜렷한 위험 신호 없음';
  }
  return { highIndex, riskTypes, signals, crisisFlag, rationale: `규칙: ${rationale}` };
}

/** 모델 평가와 규칙 하한선을 합친다. 모델 평가가 없으면(실패·mock) 규칙만 쓴다. */
export function combineAssessment(model: TurnAssessment | null, rule: TurnAssessment): TurnAssessment {
  if (!model) return rule;
  const useRule = rule.highIndex > model.highIndex;
  return {
    highIndex: clamp(Math.max(model.highIndex, rule.highIndex)),
    riskTypes: unique([...model.riskTypes, ...rule.riskTypes]),
    signals: unique([...model.signals, ...rule.signals]).slice(0, 8),
    crisisFlag: model.crisisFlag || rule.crisisFlag,
    rationale: useRule ? `${model.rationale} (${rule.rationale}로 하한 적용)` : model.rationale,
  };
}

export interface SessionRisk {
  highIndex: number;
  peakHighIndex: number;
  level: Urgency;
  crisisFlag: boolean;
  riskTypes: string[];
  signals: string[];
  rationale: string;
  alertedAt: Date | null;
}

/** 세션 누적 상태에 이번 턴 평가를 반영한다. 위기 표시·최고치·첫 HIGH 알림 시각은 유지된다. */
export function mergeSessionRisk(prev: SessionRisk, turn: TurnAssessment, now = new Date()): SessionRisk {
  const crisisFlag = prev.crisisFlag || turn.crisisFlag;
  // 위기 표현이 한 번이라도 있었으면 이후 대화가 가벼워져도 HIGH 아래로 내려가지 않는다.
  const highIndex = crisisFlag ? Math.max(turn.highIndex, HIGH_THRESHOLD) : turn.highIndex;
  const level = levelOf(highIndex);
  return {
    highIndex,
    peakHighIndex: Math.max(prev.peakHighIndex, highIndex),
    level,
    crisisFlag,
    riskTypes: unique([...prev.riskTypes, ...turn.riskTypes]),
    signals: unique([...prev.signals, ...turn.signals]).slice(0, 12),
    rationale: turn.rationale,
    alertedAt: prev.alertedAt ?? (level === 'HIGH' ? now : null),
  };
}

export const CRISIS_RESOURCES = [
  { name: '자살예방상담전화', contact: '109', note: '24시간' },
  { name: '청소년상담전화', contact: '1388', note: '24시간 · 문자/카톡 상담 가능' },
  { name: '긴급 신고', contact: '112 / 119', note: '지금 위험하다면' },
] as const;

/** 위기 신호가 있는 턴에 답장 끝에 이어 보내는 연락처 안내 (답장에 이미 109/1388이 있으면 생략) */
export const CRISIS_LINE =
  '혼자 견디지 않아도 돼요. 지금 바로 109(자살예방상담전화)나 1388(청소년상담전화)에 연락할 수 있고, 믿을 수 있는 선생님이나 어른에게도 꼭 알려 주세요.';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const unique = <T>(items: T[]) => [...new Set(items)];
