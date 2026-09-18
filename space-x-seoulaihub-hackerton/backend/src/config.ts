import { fileURLToPath } from 'node:url';
import { createGeminiProvider } from './ai/gemini.js';
import { mockProvider } from './ai/mock.js';
import type { AiProvider } from './ai/types.js';

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
  const fallbackModels = (env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash').split(',').map((m) => m.trim()).filter(Boolean);
  return {
    port: Number(env.PORT ?? 4000),
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR || fromRoot('.data/pglite'),
    aiProvider: (env.AI_PROVIDER || (env.GEMINI_API_KEY ? 'gemini' : 'mock')).toLowerCase(),
    gemini: {
      apiKey: env.GEMINI_API_KEY ?? '',
      models: [env.GEMINI_MODEL || 'gemini-3.6-flash', ...fallbackModels],
      timeoutMs: Number(env.GEMINI_TIMEOUT_MS ?? 15000),
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
