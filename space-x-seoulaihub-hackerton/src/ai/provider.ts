import type { CaseProfile, Urgency } from "../types.js";

export type StructureInput = { note: string };

export type StructureProvider = {
  readonly name: string;
  structure(input: StructureInput): Promise<CaseProfile>;
};

const HIGH_SIGNALS = [
  "결석",
  "학교 가기 싫",
  "친구",
  "잠을 못",
  "힘들어",
] as const;

export function detectHigh(note: string): boolean {
  return HIGH_SIGNALS.some((signal) => note.includes(signal));
}

function buildSummary(note: string, high: boolean): string {
  const bits: string[] = [];
  if (note.includes("결석") || note.includes("학교 가기 싫")) {
    bits.push("결석·등교 거부 신호");
  }
  if (note.includes("친구")) bits.push("또래 갈등");
  if (note.includes("잠을 못") || note.includes("잠")) bits.push("수면 어려움");
  if (note.includes("힘들어")) bits.push("정서적 어려움");
  const core = bits.length > 0 ? bits.join(", ") : "상담 메모 기반 구조화";
  return high ? `${core} — HIGH 검토 제안` : `${core} — 일반 검토 제안`;
}

function buildRiskTypes(note: string): string[] {
  const risks = new Set<string>();
  if (note.includes("결석") || note.includes("학교 가기 싫")) {
    risks.add("학교중단");
  }
  if (note.includes("친구")) risks.add("대인관계");
  if (note.includes("잠을 못") || note.includes("힘들어")) {
    risks.add("정신건강");
  }
  if (risks.size === 0) risks.add("학업·진로");
  return [...risks];
}

function buildNeeds(riskTypes: string[]): string[] {
  const needs = new Set<string>();
  if (riskTypes.includes("정신건강") || riskTypes.includes("대인관계")) {
    needs.add("심리상담");
  }
  if (riskTypes.includes("학교중단")) needs.add("학교적응");
  if (riskTypes.includes("학업·진로")) needs.add("학업지원");
  if (needs.size === 0) needs.add("심리상담");
  return [...needs];
}

export function mockStructureFromNote(note: string): CaseProfile {
  const high = detectHigh(note);
  const suggestedUrgency: Urgency = high ? "HIGH" : "MEDIUM";
  const riskTypes = buildRiskTypes(note);
  return {
    summary: buildSummary(note, high),
    riskTypes,
    needs: buildNeeds(riskTypes),
    suggestedUrgency,
    confirmedUrgency: null,
    confirmedAt: null,
  };
}

export const mockStructureProvider: StructureProvider = {
  name: "mock",
  async structure({ note }) {
    return mockStructureFromNote(note);
  },
};
