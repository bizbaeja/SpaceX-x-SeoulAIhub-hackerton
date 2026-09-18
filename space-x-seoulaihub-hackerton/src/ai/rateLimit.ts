import { createHash } from "node:crypto";
import type { CaseProfile } from "../types.js";

/** Free-tier safe default: ~5 RPM → one live call every 13s. */
const MIN_GAP_MS = Number(process.env.AI_MIN_GAP_MS ?? 13_000);
const CACHE_TTL_MS = Number(process.env.AI_CACHE_TTL_MS ?? 60 * 60 * 1000);

type CacheEntry = {
  profile: CaseProfile;
  at: number;
};

const noteCache = new Map<string, CacheEntry>();
let lastLiveCallAt = 0;
let inFlight: Promise<CaseProfile> | null = null;

export function hashNote(note: string): string {
  return createHash("sha256").update(note.trim()).digest("hex");
}

export function getCachedProfile(note: string): CaseProfile | null {
  const key = hashNote(note);
  const hit = noteCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    noteCache.delete(key);
    return null;
  }
  return {
    ...hit.profile,
    confirmedUrgency: null,
    confirmedAt: null,
  };
}

export function setCachedProfile(note: string, profile: CaseProfile): void {
  noteCache.set(hashNote(note), {
    profile: {
      ...profile,
      confirmedUrgency: null,
      confirmedAt: null,
    },
    at: Date.now(),
  });
  // keep cache bounded
  if (noteCache.size > 100) {
    const oldest = noteCache.keys().next().value;
    if (oldest) noteCache.delete(oldest);
  }
}

export function msUntilNextLiveCall(): number {
  const elapsed = Date.now() - lastLiveCallAt;
  return Math.max(0, MIN_GAP_MS - elapsed);
}

export function markLiveCall(): void {
  lastLiveCallAt = Date.now();
}

/** Serialize live Gemini calls and skip if another is in flight. */
export async function withLiveCallGate<T>(
  run: () => Promise<T>
): Promise<{ value: T; skipped: boolean }> {
  const wait = msUntilNextLiveCall();
  if (wait > 0) {
    return { value: null as T, skipped: true };
  }
  if (inFlight) {
    return { value: null as T, skipped: true };
  }

  markLiveCall();
  inFlight = run() as Promise<CaseProfile>;
  try {
    const value = (await inFlight) as T;
    return { value, skipped: false };
  } finally {
    inFlight = null;
  }
}
