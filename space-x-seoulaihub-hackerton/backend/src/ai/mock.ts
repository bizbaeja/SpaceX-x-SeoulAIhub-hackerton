import { NEEDS, RISK_TO_NEED, RISK_TYPES, type Need, type RiskType, type Urgency } from '../domain.js';
import type { AiProvider, StructureInput, StructuredProfile } from './types.js';

// 결정적(deterministic) 키워드 규칙. 실제 AI가 없거나 실패할 때의 대체 경로이자,
// 자해·자살 신호 안전장치(detectCrisis)의 기준이다.
interface SignalRule {
  riskType: RiskType;
  label: string;
  pattern: RegExp;
  /** 영역 개수와 무관하게 HIGH 검토를 제안해야 하는 신호 */
  escalate?: boolean;
}

export const SIGNAL_RULES: SignalRule[] = [
  { riskType: '자해·자살위험', label: '자해·자살 관련 표현', pattern: /자해|자살|죽고\s*싶|죽어\s*버리|사라지고\s*싶|극단적\s*선택|손목을?\s*긋/, escalate: true },
  { riskType: '학교중단', label: '결석 증가', pattern: /결석/ },
  { riskType: '학교중단', label: '등교 거부감', pattern: /학교\s*가기\s*싫|등교\s*거부/ },
  { riskType: '학교중단', label: '학업중단 언급', pattern: /자퇴|학교를?\s*그만/ },
  // '친구' 단독은 긍정 맥락("친구랑 잘 지냄")도 걸리므로 부정 맥락이 함께 있을 때만 신호로 본다.
  {
    riskType: '대인관계',
    label: '친구관계 갈등',
    pattern: /친구.{0,12}(갈등|싸우|싸운|싸웠|싸움|다투|다툰|다퉈|다퉜|다툼|멀어|무시|놀리|놀림|험담|사이가?\s*안\s*좋)/,
  },
  { riskType: '대인관계', label: '따돌림·괴롭힘', pattern: /따돌|왕따|괴롭힘|괴롭히|학교\s*폭력|학폭/ },
  { riskType: '대인관계', label: '또래 고립', pattern: /혼자\s*(먹|다니|지내|있)/ },
  { riskType: '정신건강', label: '수면 어려움', pattern: /잠을\s*못|잠이\s*안|불면|수면/ },
  { riskType: '정신건강', label: '정서적 소진', pattern: /힘들어|힘들다|지쳤|무기력/ },
  { riskType: '정신건강', label: '우울·불안', pattern: /우울|불안|눈물|울었|울어/ },
  { riskType: '학업·진로', label: '성적·학업 부담', pattern: /성적|수업을?\s*따라가|시험|공부/ },
  { riskType: '학업·진로', label: '진로 고민', pattern: /진로|꿈이\s*없/ },
  { riskType: '과의존·중독', label: '스마트폰·게임 과의존', pattern: /게임|스마트폰|휴대폰|핸드폰/ },
  { riskType: '과의존·중독', label: '음주·흡연', pattern: /음주|술을|흡연|담배/ },
  { riskType: '가족', label: '가정 내 갈등', pattern: /부모님?.{0,6}(갈등|싸우|싸운|싸웠|싸움|다투|다툰|다퉜|다툼)|집에\s*가기\s*싫|가정\s*불화/ },
  { riskType: '가족', label: '가정폭력·학대 의심', pattern: /가정\s*폭력|학대|부모님?.{0,6}(때리|때려|폭행)/, escalate: true },
];

export function detectCrisis(note: string): boolean {
  return SIGNAL_RULES.some((r) => r.riskType === '자해·자살위험' && r.pattern.test(note));
}

/** 위험 분류별 가중치로 needs 우선순위를 만든다. 위기개입은 항상 최우선. */
export function needsFromRisks(riskWeights: Map<RiskType, number>): Need[] {
  const needWeights = new Map<Need, number>();
  for (const [risk, weight] of riskWeights) {
    const need = RISK_TO_NEED[risk];
    const bonus = risk === '자해·자살위험' ? 100 : 0;
    needWeights.set(need, (needWeights.get(need) ?? 0) + weight + bonus);
  }
  return [...needWeights.entries()]
    .sort((a, b) => b[1] - a[1] || NEEDS.indexOf(a[0]) - NEEDS.indexOf(b[0]))
    .map(([need]) => need);
}

/** 텍스트에서 규칙 신호를 찾는다. riskTypes는 신호가 많은 영역 순. (구조화·채팅 공용) */
export function detectSignals(text: string) {
  const matched = SIGNAL_RULES.filter((r) => r.pattern.test(text));
  const riskWeights = new Map<RiskType, number>();
  for (const r of matched) riskWeights.set(r.riskType, (riskWeights.get(r.riskType) ?? 0) + 1);
  const riskTypes = [...riskWeights.entries()]
    .sort((a, b) => b[1] - a[1] || RISK_TYPES.indexOf(a[0]) - RISK_TYPES.indexOf(b[0]))
    .map(([risk]) => risk);
  return {
    riskWeights,
    riskTypes,
    signals: matched.map((r) => r.label),
    crisisFlag: matched.some((r) => r.riskType === '자해·자살위험'),
    escalated: matched.some((r) => r.escalate),
  };
}

export function analyzeNote({ note, ageBand, region }: StructureInput): StructuredProfile {
  const { riskWeights, riskTypes, signals, crisisFlag, escalated } = detectSignals(note);
  const areas = `${riskTypes.length}개 영역(${riskTypes.join(', ')})`;

  let suggestedUrgency: Urgency;
  let urgencyRationale: string;
  if (crisisFlag) {
    suggestedUrgency = 'HIGH';
    urgencyRationale = '자해·자살 관련 표현 감지 — 즉시 위기 대응 필요';
  } else if (escalated) {
    suggestedUrgency = 'HIGH';
    urgencyRationale = '가정폭력·학대 의심 표현 감지 — 보호 조치 검토 필요';
  } else if (riskTypes.length >= 3) {
    suggestedUrgency = 'HIGH';
    urgencyRationale = `위험 신호가 ${areas}에서 동시에 관찰됨`;
  } else if (riskTypes.length > 0) {
    suggestedUrgency = 'MEDIUM';
    urgencyRationale = `위험 신호 ${areas} 관찰`;
  } else {
    suggestedUrgency = 'LOW';
    urgencyRationale = '뚜렷한 위험 신호가 관찰되지 않음';
  }

  const summary =
    signals.length > 0
      ? `${ageBand}세 학생(${region}). ${signals.join(', ')} 신호가 관찰됨. ${riskTypes.join('·')} 영역 지원 검토 필요.`
      : `${ageBand}세 학생(${region}). 뚜렷한 위험 신호는 관찰되지 않음. 경과 관찰 권장.`;

  return {
    summary,
    riskTypes,
    needs: needsFromRisks(riskWeights),
    signals,
    suggestedUrgency,
    urgencyRationale,
    crisisFlag,
  };
}

export const mockProvider: AiProvider = {
  name: 'mock',
  structure: async (input) => analyzeNote(input),
};
