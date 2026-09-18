import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiProvider, parseModelOutput } from '../src/ai/gemini.js';
import { createAiService, maskPII } from '../src/ai/index.js';
import { analyzeNote } from '../src/ai/mock.js';
import type { AiProvider } from '../src/ai/types.js';
import { DEMO_NOTE } from '../src/domain.js';

const base = { ageBand: '13-18', region: '강남구' };

describe('mock AI 구조화', () => {
  it('docs 4.4 예시 메모는 3개 영역 신호로 HIGH를 제안하고, 심리상담을 주요 need로 둔다', () => {
    const p = analyzeNote({ ...base, note: DEMO_NOTE });
    expect(p.suggestedUrgency).toBe('HIGH');
    expect([...p.riskTypes].sort()).toEqual(['대인관계', '정신건강', '학교중단'].sort());
    expect(p.needs).toEqual(['심리상담', '학교적응']);
    expect(p.signals).toEqual(expect.arrayContaining(['결석 증가', '등교 거부감', '친구관계 갈등', '수면 어려움']));
    expect(p.crisisFlag).toBe(false);
  });

  it("'친구' 단독 긍정 맥락은 위험 신호로 보지 않는다", () => {
    const p = analyzeNote({ ...base, note: '요즘 친구랑 잘 지내고 동아리 활동도 즐겁게 한다고 함.' });
    expect(p.riskTypes).toEqual([]);
    expect(p.suggestedUrgency).toBe('LOW');
  });

  it('자해·자살 표현은 영역 개수와 무관하게 HIGH + 위기개입 최우선', () => {
    const p = analyzeNote({ ...base, note: '시험 성적 이야기를 하다가 가끔 죽고 싶다는 생각이 든다고 함.' });
    expect(p.crisisFlag).toBe(true);
    expect(p.suggestedUrgency).toBe('HIGH');
    expect(p.needs[0]).toBe('위기개입');
  });
});

describe('AI 서비스 경계', () => {
  it('실제 AI가 실패하면 mock으로 대체하고 사유를 남긴다', async () => {
    const failing: AiProvider = { name: 'gemini:test', structure: async () => { throw new Error('timeout'); } };
    const out = await createAiService(failing).structure({ ...base, note: DEMO_NOTE });
    expect(out.provider).toBe('mock-fallback');
    expect(out.fallbackReason).toBe('timeout');
    expect(out.profile.suggestedUrgency).toBe('HIGH');
  });

  it('모델이 위기 신호를 놓쳐도 규칙 안전장치가 HIGH로 올린다', async () => {
    const careless: AiProvider = {
      name: 'gemini:test',
      structure: async () => ({
        summary: '학업 스트레스.',
        riskTypes: ['학업·진로'],
        needs: ['학업지원'],
        signals: ['학업 스트레스'],
        suggestedUrgency: 'LOW',
        urgencyRationale: '경미',
        crisisFlag: false,
      }),
    };
    const out = await createAiService(careless).structure({ ...base, note: '공부가 힘들어서 자해를 한 적이 있다고 함.' });
    expect(out.profile.crisisFlag).toBe(true);
    expect(out.profile.suggestedUrgency).toBe('HIGH');
    expect(out.profile.needs[0]).toBe('위기개입');
    expect(out.profile.urgencyRationale).toContain('원 제안: LOW');
  });

  it('AI 전송/저장 전에 전화번호·주민번호·이메일을 가린다', async () => {
    const seen: string[] = [];
    const spy: AiProvider = { name: 'spy', structure: async (input) => { seen.push(input.note); return analyzeNote(input); } };
    const note = '보호자 010-1234-5678, 주민번호 080101-3123456, 메일 parent@example.com 으로 연락 가능. 결석이 잦음.';
    const out = await createAiService(spy).structure({ ...base, note });
    expect(seen[0]).toBe(out.maskedNote);
    expect(out.maskedNote).not.toMatch(/010-1234-5678|080101-3123456|parent@example\.com/);
    expect(maskPII('02-123-4567')).toBe('[전화번호]');
  });
});

describe('Gemini provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  const geminiOk = (json: object) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: 'STOP' }] }), { status: 200 });
  const geminiErr = (status: number) => new Response(JSON.stringify({ error: { status: 'X', message: 'fail' } }), { status });
  const answer = {
    summary: '결석 증가, 또래 갈등, 수면 문제',
    riskTypes: ['학교중단', '대인관계', '정신건강'],
    needs: ['심리상담', '학교적응'],
    signals: ['결석 증가'],
    suggestedUrgency: 'HIGH',
    urgencyRationale: '3개 영역',
    crisisFlag: false,
  };

  it('AQ. 키를 x-goog-api-key 헤더로 보내고, 폐기된 모델(404)이면 다음 모델로 넘어간다', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(geminiErr(404)).mockResolvedValueOnce(geminiOk(answer));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createGeminiProvider({ apiKey: 'AQ.test', models: ['old-model', 'gemini-3.6-flash'], timeoutMs: 1000 });

    const result = await provider.structure({ ...base, note: DEMO_NOTE });
    expect(result.via).toBe('gemini:gemini-3.6-flash');
    expect(result.suggestedUrgency).toBe('HIGH');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
    expect(url).not.toContain('key=');
    expect(init.headers['x-goog-api-key']).toBe('AQ.test');
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].text).toContain(DEMO_NOTE);
  });

  it('키 오류(401)는 다른 모델을 시도하지 않고 실패 → 서비스가 mock으로 대체', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiErr(401));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createGeminiProvider({ apiKey: 'AQ.bad', models: ['a', 'b'], timeoutMs: 1000 });
    const out = await createAiService(provider).structure({ ...base, note: DEMO_NOTE });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.provider).toBe('mock-fallback');
    expect(out.fallbackReason).toContain('HTTP 401');
  });

  it('Gemini 응답 via가 provider 이름으로 기록된다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiOk(answer)));
    const provider = createGeminiProvider({ apiKey: 'AQ.test', models: ['gemini-3.6-flash'], timeoutMs: 1000 });
    const out = await createAiService(provider).structure({ ...base, note: DEMO_NOTE });
    expect(out.provider).toBe('gemini:gemini-3.6-flash');
    expect(out.fallbackReason).toBeNull();
  });
});

describe('모델 응답 파싱', () => {
  it('코드블록/설명이 섞여도 JSON만 추출하고 taxonomy 밖 값은 버린다', () => {
    const text = '결과입니다:\n```json\n{"summary":"결석 증가.","riskTypes":["학교중단","없는분류"],"needs":[],"signals":["결석"],"suggestedUrgency":"MEDIUM","urgencyRationale":"결석 증가","crisisFlag":false}\n```';
    const p = parseModelOutput(text);
    expect(p.riskTypes).toEqual(['학교중단']);
    expect(p.needs).toEqual(['학교적응']); // riskTypes에서 유도
    expect(p.suggestedUrgency).toBe('MEDIUM');
  });

  it('JSON이 없으면 실패시켜 mock 대체 경로로 보낸다', () => {
    expect(() => parseModelOutput('죄송합니다. 도와드릴 수 없습니다.')).toThrow();
  });
});
