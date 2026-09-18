const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const MODEL = process.env.GEMMA_MODEL || "gemma-4-26b-a4b-it";
const API_KEY_FILE =
  process.env.GOOGLE_API_KEY_FILE ||
  path.join(os.homedir(), "OneDrive", "Desktop", "api\uD0A4.txt");
const PUBLIC_DIR = path.join(__dirname, "public");

const institutionDataset = require("./institutions-data.json");
const institutions = institutionDataset.institutions;

const cases = new Map();
const chatSessions = new Map();
const chatCaseRequests = new Map();

const CHAT_RESOURCES = [
  { name: "자살예방상담전화", contact: "109", note: "24시간" },
  { name: "청소년상담전화", contact: "1388", note: "24시간" }
];

function isCrisisMessage(message) {
  return /죽고\s*싶|죽을\s*(래|거|것)|사라지고\s*싶|자해|자살|손목.{0,8}긋/.test(message);
}

function mockChatReply(message) {
  if (isCrisisMessage(message)) {
    return "그렇게 힘든 마음을 말해줘서 고마워요. 지금 있는 곳은 안전한가요? 혼자 견디지 않아도 돼요. 지금 바로 109(자살예방상담전화)나 1388(청소년상담전화)에 연락하고, 믿을 수 있는 어른에게 알려 주세요.";
  }
  if (/친구|또래|다툼|갈등/.test(message)) return "친구와의 일 때문에 마음이 많이 쓰였겠어요. 어떤 일이 있었는지 편한 만큼 말해 줄래요?";
  if (/학교|결석|등교|잠|수면|힘들/.test(message)) return "오늘 많이 버거웠겠어요. 지금 가장 힘든 부분부터 천천히 말해도 괜찮아요.";
  return "응, 듣고 있어요. 오늘 있었던 일을 편한 만큼 이어서 이야기해도 괜찮아요.";
}

function summarizeChatForCase(session) {
  const messages = session.messages.filter(item => item.role === "youth").map(item => item.content).join(" ");
  if (isCrisisMessage(messages)) return "자해·자살 관련 어려움이 표현되어 즉시 안전 확인과 위기지원 검토가 필요합니다.";
  if (/친구|또래|다툼|갈등/.test(messages)) return "또래관계의 어려움과 정서적 지원 필요가 표현되었습니다.";
  if (/학교|결석|등교/.test(messages)) return "학교생활의 부담과 학교적응 지원 필요가 표현되었습니다.";
  return "학생이 정서적 어려움에 대한 도움을 요청했습니다.";
}

async function createChatReply(session, content) {
  const fallback = mockChatReply(content);
  if (isCrisisMessage(content)) return fallback;
  try {
    getApiKey();
    const prompt = `너는 ${session.ageBand} 청소년의 이야기를 듣는 AI 친구다. 판단·진단·훈계 없이 따뜻한 해요체로 2문장 이내로 답한다. 이전 대화: ${session.messages.map(item => `${item.role}: ${item.content}`).join("\n")}\n학생: ${content}`;
    const result = await callGoogleModel(prompt, { responseMimeType: null, temperature: 0.55, maxOutputTokens: 180 });
    return result.text.trim() || fallback;
  } catch {
    return fallback;
  }
}

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
      "Google API 키를 읽지 못했습니다. GOOGLE_API_KEY_FILE 또는 Desktop의 api키.txt를 확인하세요."
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
  thinkingLevel = model.startsWith("gemini-3.8") ? "low" : "minimal"
} = {}) {
  const key = getApiKey();
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
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
      throw new Error(message);
    }

    const text =
      payload?.candidates?.[0]?.content?.parts
        ?.filter(part => !part.thought)
        .map(part => part.text || "")
        .join("") || "";

    if (!text) throw new Error(`${model}이 빈 응답을 반환했습니다.`);
    return { text, model };
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemma(prompt) {
  return callGoogleModel(prompt, { model: MODEL });
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
      const ageOk = !item.ages || (Number.isFinite(age) && age >= item.ages[0] && age <= item.ages[1]);
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
    caseData: record.caseData,
    route: record.route || [],
    pending: record.pending,
    timeline: record.timeline,
    handoffDocument: record.handoffDocument || null
  };
}

async function apiRouter(req, res, pathname) {
  if (req.method === "POST" && pathname === "/api/chat/sessions") {
    const body = await readBody(req);
    const ageBand = String(body.ageBand || "13-15").trim();
    const region = String(body.region || "서울").trim();
    if (!ageBand || !region) return json(res, 400, { error: "ageBand와 region이 필요합니다." });
    const id = crypto.randomUUID();
    const greeting = "안녕, 나는 모아야. 오늘은 어땠어? 편한 만큼만 이야기해도 괜찮아.";
    chatSessions.set(id, { id, ageBand, region, messages: [{ role: "assistant", content: greeting }] });
    return json(res, 201, { sessionId: id, messages: [{ role: "assistant", content: greeting }], notice: "대화 전체는 자동으로 공유되지 않습니다." });
  }

  const chatMessageMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/messages$/);
  if (req.method === "POST" && chatMessageMatch) {
    const session = chatSessions.get(chatMessageMatch[1]);
    if (!session) return json(res, 404, { error: "대화를 찾지 못했습니다." });
    const body = await readBody(req);
    const content = String(body.content || "").trim();
    if (!content || content.length > 1000) return json(res, 400, { error: "메시지는 1~1000자로 입력하세요." });
    session.messages.push({ role: "youth", content });
    const reply = await createChatReply(session, content);
    session.messages.push({ role: "assistant", content: reply });
    const result = { message: { role: "assistant", content: reply }, resources: isCrisisMessage(content) ? CHAT_RESOURCES : null };
    if (body.stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });
      res.write(`event: delta\ndata: ${JSON.stringify({ text: reply })}\n\n`);
      res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
      return true;
    }
    return json(res, 200, result);
  }

  const helpRequestMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/help-request$/);
  if (req.method === "POST" && helpRequestMatch) {
    const session = chatSessions.get(helpRequestMatch[1]);
    if (!session) return json(res, 404, { error: "대화를 찾지 못했습니다." });
    const body = await readBody(req);
    if (body.consentToShare !== true) return json(res, 400, { error: "도움 요청을 위해 공유 동의가 필요합니다." });
    if (!session.messages.some(item => item.role === "youth")) return json(res, 409, { error: "도움 요청에 사용할 학생 메시지가 없습니다." });
    if (session.caseId) return json(res, 409, { error: "이미 도움 요청이 전달되었습니다." });
    const caseId = crypto.randomUUID();
    chatCaseRequests.set(caseId, {
      id: caseId,
      source: "STUDENT_AI_REQUEST",
      ageBand: session.ageBand,
      region: session.region,
      summary: summarizeChatForCase(session),
      consentStatus: "CONFIRMED"
    });
    session.caseId = caseId;
    return json(res, 201, { caseId, source: "STUDENT_AI_REQUEST", consentToShare: true });
  }

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
      institutions: institutions.length,
      datasetVerifiedAt: institutionDataset.verifiedAt
    });
  }

  if (req.method === "GET" && pathname === "/api/institutions") {
    return json(res, 200, institutionDataset);
  }

  if (req.method === "POST" && pathname === "/api/structure") {
    const body = await readBody(req);
    const note = String(body.note || "").trim();
    if (note.length < 20) return json(res, 400, { error: "상담 메모를 20자 이상 입력하세요." });

    const result = await callGemma(structurePrompt(note));
    const structured = cleanModelJson(result.text);
    return json(res, 200, { structured, model: result.model });
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

    const result = await callGemma(handoffPrompt(body.caseData || {}, institution));
    const document = cleanModelJson(result.text);
    return json(res, 200, { document, model: result.model });
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
      route: [
        {
          id: "school",
          name: "학교 학생맞춤통합지원 담당자",
          type: "source",
          state: "sent"
        },
        {
          id: institution.id,
          name: institution.name,
          type: "institution",
          state: "reviewing",
          via: "school",
          reason: "최초 기관 인계"
        }
      ],
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
      const currentRoute = record.route?.at(-1);
      if (currentRoute) currentRoute.state = "supplement";
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
      const currentRoute = record.route?.at(-1);
      if (currentRoute) currentRoute.state = "reviewing";
      record.pending = null;
      record.timeline.push(
        timelineEvent("보완 후 재제출", "요청된 정보만 추가해 동일 기관에 다시 제출했습니다.", "학교 담당자")
      );
    } else if (action === "reroute") {
      const targetInstitutionId = String(body.targetInstitutionId || "").trim();
      const reason = String(body.reason || "").trim();
      const next = institutions.find(item => item.id === targetInstitutionId);

      if (!next) return json(res, 400, { error: "직접 인계할 기관을 선택하세요." });
      if (next.id === record.currentInstitution.id) {
        return json(res, 400, { error: "현재 검토 중인 기관과 다른 기관을 선택하세요." });
      }
      if (reason.length < 5) {
        return json(res, 400, { error: "직접 인계 사유를 구체적으로 입력하세요." });
      }

      const previous = record.currentInstitution;
      const draftResult = await callGemma(handoffPrompt(record.caseData, next));
      const nextDocument = cleanModelJson(draftResult.text);

      const previousRoute = record.route?.at(-1);
      if (previousRoute) previousRoute.state = "transferred";

      record.currentInstitution = next;
      record.handoffDocument = nextDocument;
      record.status = "기관 직접 인계 · 검토 중";
      record.pending = null;
      record.route = record.route || [];
      record.route.push({
        id: next.id,
        name: next.name,
        type: "institution",
        state: "reviewing",
        via: previous.id,
        reason
      });
      record.timeline.push(
        timelineEvent(
          "기관 직접 인계",
          `${previous.name}이(가) ${next.name}에 직접 인계했습니다. 사유: ${reason}`,
          previous.name
        )
      );
    } else if (action === "accept") {
      record.status = "주관기관 책임 수락";
      record.currentOwner = record.currentInstitution.name;
      const currentRoute = record.route?.at(-1);
      if (currentRoute) currentRoute.state = "accepted";
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
  const relative =
    pathname === "/" ? "entry.html" :
    pathname === "/chat" ? "chat/index.html" :
    pathname === "/teacher" ? "index.html" :
    pathname.replace(/^\//, "");
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

const server = http.createServer(async (req, res) => {
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
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`잇다 MVP: http://127.0.0.1:${PORT}`);
    console.log(`Gemma model: ${MODEL}`);
    console.log("API key is read server-side only; key contents are never logged.");
  });
}

module.exports = {
  server,
  callGemma,
  callGoogleModel,
  cleanModelJson,
  structurePrompt,
  matchInstitutions,
  getApiKey
};
