import { detectCrisis, mockProvider } from './mock.js';
import type { AiProvider, StructureInput, StructuredProfile } from './types.js';

export type { AiProvider, StructureInput, StructuredProfile } from './types.js';

export interface StructureOutcome {
  /** 개인정보 마스킹된 메모 (DB 저장/AI 전송에 이 값만 쓴다) */
  maskedNote: string;
  profile: StructuredProfile;
  provider: string;
  /** 실제 AI 실패로 mock을 썼을 때의 사유 */
  fallbackReason: string | null;
  durationMs: number;
}

export interface AiService {
  readonly provider: string;
  structure(input: StructureInput): Promise<StructureOutcome>;
}

export function createAiService(primary: AiProvider): AiService {
  return {
    provider: primary.name,
    async structure(input) {
      const startedAt = Date.now();
      const maskedNote = maskPII(input.note);
      const masked = { ...input, note: maskedNote };

      let profile: StructuredProfile;
      let provider = primary.name;
      let fallbackReason: string | null = null;
      try {
        const { via, ...result } = await primary.structure(masked);
        profile = result;
        provider = via ?? primary.name;
      } catch (err) {
        if (primary === mockProvider) throw err;
        fallbackReason = err instanceof Error ? err.message : String(err);
        console.warn(`[ai] ${primary.name} 실패 → mock 대체: ${fallbackReason}`);
        provider = 'mock-fallback';
        profile = await mockProvider.structure(masked);
      }

      profile = { ...applyCrisisSafetyNet(profile, maskedNote), summary: maskPII(profile.summary) };
      return { maskedNote, profile, provider, fallbackReason, durationMs: Date.now() - startedAt };
    },
  };
}

/** 자해·자살 신호는 모델 결과와 무관하게 규칙으로 한 번 더 확인해 HIGH/위기개입으로 올린다. */
export function applyCrisisSafetyNet(profile: StructuredProfile, note: string): StructuredProfile {
  if (!profile.crisisFlag && !detectCrisis(note)) return profile;
  const upgraded = profile.suggestedUrgency !== 'HIGH';
  return {
    ...profile,
    crisisFlag: true,
    suggestedUrgency: 'HIGH',
    riskTypes: [...new Set(['자해·자살위험' as const, ...profile.riskTypes])],
    needs: [...new Set(['위기개입' as const, ...profile.needs])],
    urgencyRationale: upgraded
      ? `자해·자살 위험 표현 감지로 HIGH 상향 (원 제안: ${profile.suggestedUrgency})`
      : profile.urgencyRationale,
  };
}

/** 주민번호·전화번호·이메일을 가린다. 실명은 입력 단계에서 가명 사용을 강제한다. */
export function maskPII(text: string): string {
  return text
    .replace(/\d{6}\s*-\s*[1-4]\d{6}/g, '[주민번호]')
    .replace(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[전화번호]')
    .replace(/0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}/g, '[전화번호]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[이메일]');
}
