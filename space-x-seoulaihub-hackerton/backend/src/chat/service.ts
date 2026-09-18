import { setTimeout as sleep } from 'node:timers/promises';
import { maskPII } from '../ai/index.js';
import { detectSignals } from '../ai/mock.js';
import { mockChatProvider, type ChatProvider, type ChatTurn } from './providers.js';
import { CRISIS_LINE, combineAssessment, ruleAssessment, type TurnAssessment } from './risk.js';

export interface ChatReplyOutcome {
  /** 개인정보 마스킹된 청소년 메시지 (DB 저장/AI 전송에 이 값만 쓴다) */
  maskedMessage: string;
  /** 학생에게 보낸 답장 전체 (스트리밍으로 보낸 조각을 합친 것) */
  reply: string;
  /** 이번 턴까지의 대화 전체 평가 (모델 ⊕ 규칙 하한선) — 교사용 */
  turn: TurnAssessment;
  provider: string;
  fallbackReason: string | null;
}

export interface ChatService {
  readonly provider: string;
  /**
   * 답장을 onDelta로 흘려보내면서, 같은 시간에 내부 평가를 병렬로 돌린다.
   * sessionCrisis: 이 세션이 이미 위기로 표시됐는지 (연락처 안내 반복 방지)
   */
  reply(input: {
    history: ChatTurn[];
    message: string;
    ageBand: string;
    sessionCrisis?: boolean;
    onDelta?: (text: string) => void;
  }): Promise<ChatReplyOutcome>;
}

export interface ChatServiceOptions {
  /** 모델은 답장을 큰 덩어리 몇 개로 보내므로, 글자가 흘러나오게 이 단위/간격으로 나눠 보낸다. (테스트는 0ms) */
  smoothChars?: number;
  smoothDelayMs?: number;
}

export function createChatService(
  primary: ChatProvider,
  fallback: ChatProvider = mockChatProvider,
  { smoothChars = 2, smoothDelayMs = 15 }: ChatServiceOptions = {},
): ChatService {
  return {
    provider: primary.name,
    async reply({ history, message, ageBand, sessionCrisis = false, onDelta = () => {} }) {
      const maskedMessage = maskPII(message);
      const turns: ChatTurn[] = [...history, { role: 'youth', content: maskedMessage }];
      const failures: string[] = [];

      // 내부 평가는 답장과 동시에 진행 (답장을 기다리지 않는다)
      const assessment = primary.assess({ history: turns, ageBand }).catch((err: unknown) => {
        failures.push(`평가: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });

      let reply = '';
      let provider = primary.name;
      const emit = async (text: string) => {
        reply += text;
        for (let i = 0; i < text.length; i += smoothChars) {
          onDelta(text.slice(i, i + smoothChars));
          if (smoothDelayMs > 0) await sleep(smoothDelayMs);
        }
      };
      try {
        for await (const text of primary.streamReply({ history: turns, ageBand }, (m) => (provider = m))) await emit(text);
      } catch (err) {
        failures.push(`답장: ${err instanceof Error ? err.message : String(err)}`);
        if (!reply) {
          // 한 글자도 못 보냈으면 mock 답장으로 대체
          provider = 'mock-fallback';
          for await (const text of fallback.streamReply({ history: turns, ageBand })) await emit(text);
        }
        // 도중에 끊겼으면 보낸 데까지를 답장으로 둔다
      }

      const modelAssessment = await assessment;
      if (failures.length > 0) console.warn(`[chat] ${failures.join(' | ')}`);
      const rule = ruleAssessment(turns.filter((t) => t.role === 'youth').map((t) => t.content));
      const turn = combineAssessment(modelAssessment, rule);

      // 이번 메시지에 위기 신호가 있거나 모델이 처음 위기로 판단하면, 답장 끝에 연락처 안내를 이어서 보낸다.
      const crisisNow = detectSignals(maskedMessage).crisisFlag || (modelAssessment?.crisisFlag === true && !sessionCrisis);
      if (crisisNow && !/109|1388/.test(reply)) await emit(`\n\n${CRISIS_LINE}`);

      return { maskedMessage, reply: reply.trim(), turn, provider, fallbackReason: failures.length ? failures.join(' | ') : null };
    },
  };
}
