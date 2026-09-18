import { fileURLToPath } from 'node:url';
import { createGeminiProvider } from './ai/gemini.js';
import { mockProvider } from './ai/mock.js';
import type { AiProvider } from './ai/types.js';
import { createGeminiChatProvider, mockChatProvider, type ChatProvider } from './chat/providers.js';

// 경로는 실행 위치와 무관하게 backend/ 기준으로 잡는다 (src/, dist/ 모두 한 단계 아래).
const fromRoot = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export function loadEnvFile() {
  try {
    process.loadEnvFile(fromRoot('.env'));
  } catch {
    // .env 없으면 환경변수만 사용
  }
}

export function loadConfig(env = process.env) {
  const list = (value: string | undefined, fallback: string) => (value || fallback).split(',').map((m) => m.trim()).filter(Boolean);
  const apiKey = env.GEMINI_API_KEY ?? '';
  const timeoutMs = Number(env.GEMINI_TIMEOUT_MS ?? 15000);
  return {
    port: Number(env.PORT ?? 4000),
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR || fromRoot('.data/pglite'),
    aiProvider: (env.AI_PROVIDER || (env.GEMINI_API_KEY ? 'gemini' : 'mock')).toLowerCase(),
    gemini: {
      apiKey,
      models: [env.GEMINI_MODEL || 'gemini-3.6-flash', ...list(env.GEMINI_FALLBACK_MODELS, 'gemini-3.5-flash-lite,gemini-3.1-flash-lite')],
      timeoutMs,
    },
    // 청소년 채팅: 답장(스트리밍)과 내부 평가에 서로 다른 모델을 써서 모델별 사용량 한도를 분산한다.
    chat: {
      reply: {
        apiKey,
        models: list(env.GEMINI_CHAT_MODELS, 'gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite'),
        timeoutMs,
        firstTokenTimeoutMs: Number(env.GEMINI_FIRST_TOKEN_TIMEOUT_MS ?? 6000),
      },
      assess: {
        apiKey,
        models: list(env.GEMINI_ASSESS_MODELS, 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash'),
        timeoutMs: Number(env.GEMINI_ASSESS_TIMEOUT_MS ?? 8000),
      },
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;

/** 실제 AI 키가 없거나 설정이 잘못되면 deterministic mock으로 동작한다. */
export function createProvider(config: Config): AiProvider {
  if (config.aiProvider === 'gemini') {
    if (config.gemini.apiKey) return createGeminiProvider(config.gemini);
    console.warn('[ai] AI_PROVIDER=gemini 이지만 GEMINI_API_KEY가 없어 mock을 사용합니다.');
  }
  return mockProvider;
}

/** 청소년 채팅용. 구조화와 같은 Gemini 설정을 쓰고, 키가 없으면 mock(고정 답장 + 규칙 평가). */
export function createChatProvider(config: Config): ChatProvider {
  return config.aiProvider === 'gemini' && config.gemini.apiKey ? createGeminiChatProvider(config.chat) : mockChatProvider;
}
