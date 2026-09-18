import type { Need, RiskType, Urgency } from '../domain.js';

export interface StructureInput {
  note: string;
  ageBand: string;
  region: string;
}

/** AI 제안. 최종 긴급도는 교사가 확정한다. */
export interface StructuredProfile {
  summary: string;
  riskTypes: RiskType[];
  needs: Need[];
  signals: string[];
  suggestedUrgency: Urgency;
  urgencyRationale: string;
  crisisFlag: boolean;
}

export interface ProviderResult extends StructuredProfile {
  /** 실제로 응답한 모델 (예: gemini:gemini-3.5-flash). 없으면 provider 이름을 쓴다. */
  via?: string;
}

export interface AiProvider {
  readonly name: string;
  structure(input: StructureInput): Promise<ProviderResult>;
}
