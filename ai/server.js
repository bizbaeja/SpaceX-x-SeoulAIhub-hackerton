const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// Optional local env: ai/.env (KEY=value lines)
(() => {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const PORT = Number(process.env.PORT || 4173);
const MODEL = process.env.GEMMA_MODEL || "gemma-4-26b-a4b-it";
const API_KEY_FILE =
  process.env.GOOGLE_API_KEY_FILE ||
  path.join(os.homedir(), "OneDrive", "Desktop", "api\uD0A4.txt");
const PUBLIC_DIR = path.join(__dirname, "public");
const MIN_LIVE_GAP_MS = Number(process.env.AI_MIN_GAP_MS || 13_000);
const AI_CACHE_TTL_MS = Number(process.env.AI_CACHE_TTL_MS || 60 * 60 * 1000);
const responseCache = new Map();
let lastLiveCallAt = 0;
let liveInFlight = null;

function hashText(text) {
  return crypto.createHash("sha256").update(String(text).trim()).digest("hex");
}

function getCached(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > AI_CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  responseCache.set(key, { at: Date.now(), value });
  if (responseCache.size > 80) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
}

function msUntilNextLiveCall() {
  return Math.max(0, MIN_LIVE_GAP_MS - (Date.now() - lastLiveCallAt));
}

const institutions = [
  {
    id: "youth-center",
    name: "마포구청소년상담복지센터",
    type: "청소년상담복지",
    evidenceLevel: "공식 공개정보 기반",
    ages: [9, 24],
    districts: ["마포구"],
    domains: ["정서", "학교적응", "가족"],
    required: ["age", "district", "consent"],
    intake: "사전 전화 예약 후 내방상담",
    publicNote: "청소년(만 9~24세) 및 학부모 대상. 상담·의료·법률·정보 등 지역 자원 연계 허브 역할을 안내하고 있습니다.",
    sourceLinks: [
      {
        label: "서비스 안내",
        url: "https://youthnaroo.or.kr/sub07/sub01.php"
      },
      {
        label: "현재 센터 홈페이지",
        url: "http://www.mapo1388.or.kr/"
      }
    ]
  },
  {
    id: "mental-health",
    name: "마포구정신건강복지센터",
    type: "아동·청소년 정신건강",
    evidenceLevel: "공식 공개정보 기반",
    ages: [7, 19],
    districts: ["마포구"],
    domains: ["정서", "자해·자살", "정신건강"],
    required: ["age", "district", "guardianConsent", "safetyStatus"],
    intake: "전화 예약 → 내소 또는 가정방문",
    publicNote: "만 7~19세 마포구 아동·청소년 및 가족, 관내 재학생·교사를 대상으로 심층평가·치료기관 연계·사례관리를 안내하며 아동·청소년은 보호자 동의 절차가 필요합니다.",
    sourceLinks: [
      {
        label: "아동청소년 사업",
        url: "https://mmhwc.or.kr/child/1"
      },
      {
        label: "이용안내",
        url: "https://mmhwc.or.kr/use/1"
      }
    ]
  },
  {
    id: "family-center",
    name: "마포구가족센터",
    type: "가족상담·가족지원",
    evidenceLevel: "공식 공개정보 기반",
    ages: [13, 99],
    districts: ["마포구"],
    domains: ["가족", "경제", "돌봄"],
    required: ["district", "consent"],
    intake: "센터별 프로그램 확인 후 사전 예약",
    publicNote: "가족갈등·부모자녀 문제 상담과 함께 경제·심리정서·양육 등 복합 어려움이 있는 가족 대상 상담·사례관리·긴급위기 지원을 안내합니다.",
    sourceLinks: [
      {
        label: "가족센터 사업 안내",
        url: "https://mapo.familynet.or.kr/web/lay1/S1T296C337/contents.do"
      },
      {
        label: "2026 가족상담 안내",
        url: "https://m.site.naver.com/1VVIs"
      }
    ]
  }
];

const cases = new Map();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 500_000) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON 요청 형식이 올바르지 않습니다."));
      }
    });
    req.on("error", reject);
  });
}

function getApiKey() {
  const fromEnv =
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  try {
    const raw = fs.readFileSync(API_KEY_FILE, "utf8").replace(/^\uFEFF/, "").trim();
    if (!raw) throw new Error("API 키 파일이 비어 있습니다.");

    // api키.txt에 여러 서비스 키나 한글 라벨이 함께 있어도 Google 키만 뽑는다.
    const tokenPattern = /[A-Za-z0-9._~+\/-]{20,}={0,2}/g;
    const labeledLines = raw
      .split(/\r?\n/)
      .filter(line => /(google|gemini|gemma|구글)/i.test(line));

    for (const line of labeledLines) {
      const candidates = line.match(tokenPattern) || [];
      const key = candidates.find(value => /^[\x21-\x7E]+$/.test(value));
      if (key) return key;
    }

    const standardKey = raw.match(/AIza[0-9A-Za-z_-]{20,}/)?.[0];
    if (standardKey) return standardKey;

    const candidates = raw.match(tokenPattern) || [];
    const key = candidates.find(value => /^[\x21-\x7E]+$/.test(value));
    if (key) return key;

    throw new Error("파일에서 Google API 키 형식의 ASCII 토큰을 찾지 못했습니다.");
  } catch (error) {
    throw new Error(
      "Google API 키를 읽지 못했습니다. ai/.env의 GOOGLE_API_KEY 또는 Desktop의 api키.txt를 확인하세요."
    );
  }
}

function cleanModelJson(text) {
  const trimmed = String(text || "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {}

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }
  throw new Error("Gemma 응답에서 JSON을 해석하지 못했습니다.");
}

async function callGoogleModel(prompt, {
  model = MODEL,
  temperature = 0.15,
  maxOutputTokens = 2200,
  responseMimeType = "application/json",
  thinkingLevel = model.startsWith("gemini-3.8") ? "low" : "minimal",
  cacheKey = null
} = {}) {
  if (cacheKey) {
    const cached = getCached(cacheKey);
    if (cached) {
      console.info("[ai] cache hit", cacheKey.slice(0, 8));
      return { ...cached, cached: true };
    }
  }

  const wait = msUntilNextLiveCall();
  if (wait > 0 || liveInFlight) {
    const err = new Error(
      `무료 한도 보호: ${Math.ceil(wait / 1000) || 1}초 뒤 다시 시도하거나, 같은 메모는 캐시 결과를 사용합니다.`
    );
    err.code = "RATE_LIMIT_SOFT";
    throw err;
  }

  const key = getApiKey();
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  lastLiveCallAt = Date.now();

  try {
    liveInFlight = true;
    const generationConfig = {
      temperature,
      maxOutputTokens,
      thinkingConfig: { thinkingLevel }
    };
    if (responseMimeType) generationConfig.responseMimeType = responseMimeType;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `Google API 오류 (${response.status})`;
      const err = new Error(message);
      if (response.status === 429) err.code = "RATE_LIMIT";
      throw err;
    }

    const text =
      payload?.candidates?.[0]?.content?.parts
        ?.filter(part => !part.thought)
        .map(part => part.text || "")
        .join("") || "";

    if (!text) throw new Error(`${model}이 빈 응답을 반환했습니다.`);
    const result = { text, model };
    if (cacheKey) setCached(cacheKey, result);
    return result;
  } finally {
    liveInFlight = false;
    clearTimeout(timeout);
  }
}

async function callGemma(prompt, cacheKey = null) {
  return callGoogleModel(prompt, { model: MODEL, cacheKey });
}

function structurePrompt(note) {
  return `당신은 서울의 위기학생 지원 인계 업무를 돕는 행정 보조 AI다.
아래 상담 메모를 진단하거나 위험확률을 계산하지 말고, '확인된 사실 / 지원 필요 영역 / 미확인 정보 / 현재 지원상황'으로 구조화하라.

절대 지켜야 할 규칙:
1. 원문에 없는 사실을 만들지 않는다.
2. 정신질환명, 고위험 점수, 확률을 부여하지 않는다.
3. 각 확인된 사실에는 반드시 원문에서 짧은 근거 문구(evidence)를 붙인다.
4. 자해·자살 관련 현재 안전상태가 확인되지 않았다면 safety.status는 반드시 "미확인"으로 둔다.
5. 외부기관 정보공유 동의가 명시되지 않았다면 consent.status는 "미확인"으로 둔다.
6. 미성년자의 보호자 동의 여부가 원문에 명시되지 않았다면 guardianConsent.status는 "미확인"으로 둔다.
7. 지원 필요 영역 area는 다음 중 필요한 것만 사용한다: "학교적응", "정서", "가족", "경제", "자해·자살", "정신건강", "돌봄".
8. 출력은 설명 없이 JSON 객체 하나만 반환한다.
9. 알 수 없는 나이/지역은 null로 둔다.

JSON 스키마:
{
  "summary": "두 문장 이내 요약",
  "student": {
    "age": 0 또는 null,
    "district": "구 단위 지역 또는 null",
    "schoolStatus": "재학/학교밖/미확인"
  },
  "facts": [
    { "label": "확인된 사실", "evidence": "원문 근거" }
  ],
  "needs": [
    { "area": "지원 영역", "reason": "필요 근거" }
  ],
  "unknowns": [
    {
      "key": "safetyStatus|consent|guardianContact|기타영문키",
      "label": "확인할 정보",
      "reason": "인계 전 확인 이유"
    }
  ],
  "safety": {
    "status": "미확인|안정 확인|즉각 확인 필요",
    "evidence": "원문 근거 또는 빈 문자열"
  },
  "consent": {
    "status": "미확인|동의|미동의",
    "evidence": "원문 근거 또는 빈 문자열"
  },
  "guardianConsent": {
    "status": "미확인|동의|미동의",
    "evidence": "원문 근거 또는 빈 문자열"
  },
  "currentSupport": ["현재 이용 중인 지원이 원문에 있을 때만 작성"]
}

상담 메모:
<<<
${note}
>>>`;
}

function handoffPrompt(caseData, institution) {
  return `당신은 기관 간 인계서를 작성하는 행정 보조 AI다.
다음 구조화 사례에서 '${institution.name}'이 업무 검토에 필요한 최소정보만 사용해 인계서 초안을 작성하라.

원칙:
- 새로운 사실을 만들지 않는다.
- 진단명이나 위험 점수를 만들지 않는다.
- 미확인 정보는 확인된 것처럼 쓰지 않는다.
- 민감한 원문 전체를 복사하지 않는다.
- 6개 필드의 JSON만 출력한다.

출력 스키마:
{
  "title": "인계 요청 제목",
  "reason": "인계 사유 1~2문장",
  "confirmed": ["확인된 핵심 사실 최대 4개"],
  "needs": ["지원 필요 영역"],
  "unknowns": ["기관 검토에 영향을 줄 미확인 정보"],
  "privacyNote": "이 초안은 담당자 검토 후 최소정보만 전송한다는 한 문장"
}

기관 조건:
${JSON.stringify({
    type: institution.type,
    domains: institution.domains,
    required: institution.required
  })}

구조화 사례:
${JSON.stringify(caseData)}`;
}

function hasValue(caseData, field) {
  if (field === "age") {
    const value = caseData?.student?.age;
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  }
  if (field === "district") return Boolean(caseData?.student?.district);
  if (field === "consent") return caseData?.consent?.status === "동의";
  if (field === "safetyStatus") {
    return Boolean(caseData?.safety?.status && caseData.safety.status !== "미확인");
  }
  if (field === "guardianContact") {
    return !caseData?.unknowns?.some(item => item.key === "guardianContact");
  }
  if (field === "guardianConsent") {
    return caseData?.guardianConsent?.status === "동의";
  }
  return false;
}

function conditionLabel(field) {
  return {
    age: "연령",
    district: "관할 지역",
    consent: "외부기관 정보공유 동의",
    safetyStatus: "현재 안전상태",
    guardianContact: "보호자 연락 가능 여부",
    guardianConsent: "보호자 동의"
  }[field] || field;
}

function matchInstitutions(caseData, excludeId = null) {
  const age = Number(caseData?.student?.age);
  const district = caseData?.student?.district;
  const needs = new Set((caseData?.needs || []).map(item => item.area));

  return institutions
    .filter(item => item.id !== excludeId)
    .map(item => {
      const ageOk = Number.isFinite(age) && age >= item.ages[0] && age <= item.ages[1];
      const regionOk =
        Boolean(district) &&
        (item.districts.includes("서울") || item.districts.includes(district));
      const matchedDomains = item.domains.filter(domain => needs.has(domain));
      const domainOk = matchedDomains.length > 0;
      const requirements = item.required.map(field => ({
        field,
        label: conditionLabel(field),
        ok: hasValue(caseData, field)
      }));
      const readyCount = requirements.filter(req => req.ok).length;
      const missing = requirements.filter(req => !req.ok).map(req => req.label);

      const score =
        (ageOk ? 25 : 0) +
        (regionOk ? 25 : 0) +
        Math.min(30, matchedDomains.length * 15) +
        Math.round((readyCount / Math.max(requirements.length, 1)) * 20);

      return {
        ...item,
        score,
        ageOk,
        regionOk,
        domainOk,
        matchedDomains,
        requirements,
        missing,
        readyToSend: ageOk && regionOk && domainOk && missing.length === 0
      };
    })
    .sort((a, b) => b.score - a.score);
}

function nowTime() {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

function timelineEvent(label, detail, actor = "시스템") {
  return { at: nowTime(), label, detail, actor };
}

function publicCase(record) {
  return {
    id: record.id,
    status: record.status,
    currentOwner: record.currentOwner,
    currentInstitution: record.currentInstitution,
    pending: record.pending,
    timeline: record.timeline,
    handoffDocument: record.handoffDocument || null
  };
}

async function apiRouter(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    let keyReadable = false;
    try {
      getApiKey();
      keyReadable = true;
    } catch {}
    return json(res, 200, {
      ok: true,
      model: MODEL,
      keyReadable,
      institutions: institutions.length
    });
  }

  if (req.method === "POST" && pathname === "/api/structure") {
    const body = await readBody(req);
    const note = String(body.note || "").trim();
    if (note.length < 20) return json(res, 400, { error: "상담 메모를 20자 이상 입력하세요." });

    const cacheKey = `structure:${hashText(note)}`;
    try {
      const result = await callGemma(structurePrompt(note), cacheKey);
      const structured = cleanModelJson(result.text);
      return json(res, 200, {
        structured,
        model: result.model,
        cached: Boolean(result.cached)
      });
    } catch (error) {
      if (error?.code === "RATE_LIMIT_SOFT" || error?.code === "RATE_LIMIT") {
        return json(res, 429, {
          error: error.message,
          retryAfterSec: Math.ceil(msUntilNextLiveCall() / 1000) || 13
        });
      }
      throw error;
    }
  }

  if (req.method === "POST" && pathname === "/api/match") {
    const body = await readBody(req);
    const matches = matchInstitutions(body.caseData || {}, body.excludeId || null);
    return json(res, 200, { matches });
  }

  if (req.method === "POST" && pathname === "/api/prepare-handoff") {
    const body = await readBody(req);
    const institution = institutions.find(item => item.id === body.institutionId);
    if (!institution) return json(res, 404, { error: "기관을 찾지 못했습니다." });

    const cacheKey = `handoff:${hashText(
      JSON.stringify({ caseData: body.caseData || {}, institutionId: body.institutionId })
    )}`;
    try {
      const result = await callGemma(handoffPrompt(body.caseData || {}, institution), cacheKey);
      const document = cleanModelJson(result.text);
      return json(res, 200, {
        document,
        model: result.model,
        cached: Boolean(result.cached)
      });
    } catch (error) {
      if (error?.code === "RATE_LIMIT_SOFT" || error?.code === "RATE_LIMIT") {
        return json(res, 429, {
          error: error.message,
          retryAfterSec: Math.ceil(msUntilNextLiveCall() / 1000) || 13
        });
      }
      throw error;
    }
  }

  if (req.method === "POST" && pathname === "/api/handoff") {
    const body = await readBody(req);
    const institution = institutions.find(item => item.id === body.institutionId);
    if (!institution) return json(res, 404, { error: "기관을 찾지 못했습니다." });

    const id = crypto.randomUUID();
    const record = {
      id,
      caseData: body.caseData || {},
      handoffDocument: body.document || null,
      status: "기관 검토 중",
      currentOwner: "학교 학생맞춤통합지원 담당자",
      currentInstitution: institution,
      pending: null,
      timeline: [
        timelineEvent("사례 생성", "AI 구조화 결과를 담당자가 확인했습니다.", "학교 담당자"),
        timelineEvent("인계 요청", `${institution.name}에 최소정보 인계서를 전송했습니다.`, "학교 담당자")
      ]
    };
    cases.set(id, record);
    return json(res, 200, publicCase(record));
  }

  const responseMatch = pathname.match(/^\/api\/cases\/([^/]+)\/respond$/);
  if (req.method === "POST" && responseMatch) {
    const id = responseMatch[1];
    const record = cases.get(id);
    if (!record) return json(res, 404, { error: "사례를 찾지 못했습니다." });
    const body = await readBody(req);
    const action = body.action;

    if (action === "supplement") {
      record.status = "보완 요청";
      record.pending = {
        type: "supplement",
        fields: ["safetyStatus"],
        message: "현재 자해·자살 관련 안전상태를 확인해 주세요."
      };
      record.timeline.push(
        timelineEvent(
          "정보 보완 요청",
          "현재 자해·자살 관련 안전상태 확인 정보가 필요합니다.",
          record.currentInstitution.name
        )
      );
    } else if (action === "resubmit") {
      record.caseData = body.caseData || record.caseData;
      record.status = "기관 재검토 중";
      record.pending = null;
      record.timeline.push(
        timelineEvent("보완 후 재제출", "요청된 정보만 추가해 동일 기관에 다시 제출했습니다.", "학교 담당자")
      );
    } else if (action === "reroute") {
      const matches = matchInstitutions(record.caseData, record.currentInstitution.id);
      const next =
        matches.find(item => item.id === "family-center" && item.readyToSend) ||
        matches.find(item => item.readyToSend && item.matchedDomains.includes("가족")) ||
        matches.find(item => item.readyToSend) ||
        matches[0];

      if (!next) return json(res, 409, { error: "재라우팅할 데모 기관이 없습니다." });

      const previous = record.currentInstitution;
      record.currentInstitution = next;
      record.status = "재라우팅 완료 · 기관 검토 중";
      record.pending = null;
      record.timeline.push(
        timelineEvent(
          "재연계 권고",
          "복합 가족지원 개입이 더 적합하다는 사유가 구조화되었습니다.",
          previous.name
        ),
        timelineEvent(
          "자동 재라우팅",
          `기존 사례정보를 재사용해 ${next.name}로 인계했습니다.`,
          "잇다"
        )
      );
    } else if (action === "accept") {
      record.status = "주관기관 책임 수락";
      record.currentOwner = record.currentInstitution.name;
      record.pending = null;
      record.timeline.push(
        timelineEvent(
          "책임 수락",
          "주관기관이 사례 책임을 수락했습니다. 첫 지원 일정 조율 단계로 이동합니다.",
          record.currentInstitution.name
        )
      );
    } else {
      return json(res, 400, { error: "지원하지 않는 응답입니다." });
    }

    return json(res, 200, publicCase(record));
  }

  return false;
}

function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const safe = path.normalize(relative).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);

  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml"
  };

  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Content-Length": data.length,
    "Cache-Control": "no-store"
  });
  res.end(data);
  return true;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await apiRouter(req, res, url.pathname);
      if (handled === false) json(res, 404, { error: "API 경로를 찾지 못했습니다." });
      return;
    }

    if (!serveStatic(res, url.pathname)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? "Gemma 응답 시간이 초과되었습니다."
        : error?.message || "서버 오류가 발생했습니다.";
    console.error("[server]", message);
    json(res, 500, { error: message });
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  const host = process.env.HOST || "0.0.0.0";
  server.listen(PORT, host, () => {
    console.log(`잇다 MVP: http://${host}:${PORT}`);
    console.log(`Gemma model: ${MODEL}`);
    console.log("API key is read server-side only; key contents are never logged.");
  });
}

// Default export for Vercel (@vercel/node)
module.exports = handleRequest;
module.exports.handleRequest = handleRequest;
module.exports.server = server;
module.exports.callGemma = callGemma;
module.exports.callGoogleModel = callGoogleModel;
module.exports.cleanModelJson = cleanModelJson;
module.exports.structurePrompt = structurePrompt;
module.exports.matchInstitutions = matchInstitutions;
module.exports.getApiKey = getApiKey;
