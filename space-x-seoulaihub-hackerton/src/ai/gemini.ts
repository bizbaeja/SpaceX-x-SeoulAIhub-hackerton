import { z } from "zod";
import type { CaseProfile } from "../types.js";
import {
  mockStructureFromNote,
  type StructureInput,
  type StructureProvider,
} from "./provider.js";

const geminiProfileSchema = z.object({
  summary: z.string().min(1),
  riskTypes: z.array(z.string()).default([]),
  needs: z.array(z.string()).default([]),
  suggestedUrgency: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

function buildPrompt(note: string): string {
  return `당신은 학교 상담 메모를 구조화하는 도우미다.
최종 긴급도는 교사가 확정한다. suggestedUrgency는 제안일 뿐이다.
학생 실명·연락처·주민번호를 만들지 마라.
아래 JSON만 출력하라. 다른 텍스트 금지.

{"summary":"짧은 한국어 요약","riskTypes":["정신건강"|"대인관계"|"학업·진로"|"학교중단"|"과의존·중독"],"needs":["심리상담"|"학교적응"|"학업지원"],"suggestedUrgency":"LOW"|"MEDIUM"|"HIGH"}

상담 메모:
${note}`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(raw);
}

async function callGemini(note: string): Promise<CaseProfile> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(note) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini empty response");

  const parsed = geminiProfileSchema.parse(extractJson(text));
  return {
    summary: parsed.summary,
    riskTypes: parsed.riskTypes,
    needs: parsed.needs,
    suggestedUrgency: parsed.suggestedUrgency,
    confirmedUrgency: null,
    confirmedAt: null,
  };
}

export const geminiStructureProvider: StructureProvider = {
  name: "gemini",
  async structure({ note }: StructureInput) {
    try {
      return await callGemini(note);
    } catch (err) {
      console.warn(
        "[structure] Gemini failed, falling back to mock:",
        err instanceof Error ? err.message : err
      );
      return mockStructureFromNote(note);
    }
  },
};
