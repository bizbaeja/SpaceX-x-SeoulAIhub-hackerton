const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const sampleNote = `마포구 소재 중학교 2학년 학생(만 14세)과 상담함.
최근 2주 동안 결석을 5번 했고, 친구들과 연락을 피하며 점심시간에도 혼자 있는 경우가 늘었다고 함.
집에서는 부모님과 거의 대화하지 않고 최근 가족 갈등이 잦다고 말함.
생활비 문제로 방과 후 활동 참여도 어렵다고 함.
자해나 죽고 싶은 생각이 있는지는 아직 확인하지 못했음.
학생에게 외부기관 최소정보 공유 취지를 설명했고, 학생이 정보공유에 동의함.`;

const state = {
  structured: null,
  matches: [],
  selectedInstitution: null,
  handoffDocument: null,
  caseRecord: null,
  stage: 1
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청 처리에 실패했습니다.");
  return data;
}

function setStage(stage) {
  state.stage = stage;
  $$(".panel").forEach(panel => panel.classList.add("hidden"));
  const target = {
    1: "#inputPanel",
    2: "#structurePanel",
    3: "#matchPanel",
    4: "#handoffPanel"
  }[stage];
  $(target).classList.remove("hidden");

  $$("#stepper li").forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle("active", n === stage);
    li.classList.toggle("done", n < stage);
  });

  window.scrollTo({ top: document.querySelector(".workspace").offsetTop - 90, behavior: "smooth" });
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function loading(button, on) {
  button.disabled = on;
  button.classList.toggle("loading", on);
}

async function checkHealth() {
  try {
    const health = await api("/api/health");
    const pulse = $(".pulse");
    pulse.classList.add(health.keyReadable ? "ok" : "bad");
    $("#modelStatus").textContent = health.keyReadable
      ? `${health.model} · 서버 연결됨`
      : "API 키 파일 확인 필요";
  } catch {
    $(".pulse").classList.add("bad");
    $("#modelStatus").textContent = "서버 연결 실패";
  }
}

function renderStructure(data) {
  $("#summaryText").textContent = data.summary || "요약 없음";

  $("#factsList").innerHTML = (data.facts || []).length
    ? data.facts.map(item => `
        <div class="fact">
          <b>${escapeHtml(item.label)}</b>
          <small>${escapeHtml(item.evidence)}</small>
        </div>`).join("")
    : `<div class="fact"><small>원문에서 확인 가능한 사실이 없습니다.</small></div>`;

  $("#unknownsList").innerHTML = (data.unknowns || []).length
    ? data.unknowns.map(item => `
        <div class="unknown">
          <b>${escapeHtml(item.label)}</b>
          <small>${escapeHtml(item.reason)}</small>
        </div>`).join("")
    : `<div class="unknown"><small>추가 확인 항목 없음</small></div>`;

  $("#needsList").innerHTML = (data.needs || []).length
    ? data.needs.map(item => `<span class="chip" title="${escapeHtml(item.reason)}">${escapeHtml(item.area)}</span>`).join("")
    : `<span class="chip">추가 확인 필요</span>`;
}

function renderMatches(matches) {
  $("#matchesList").innerHTML = matches.map((item, index) => {
    const conditions = [
      { label: "연령", ok: item.ageOk },
      { label: "지역", ok: item.regionOk },
      { label: "지원영역", ok: item.domainOk },
      ...item.requirements
        .filter(req => !["age", "district"].includes(req.field))
        .map(req => ({ label: req.label, ok: req.ok }))
    ];

    const passed = conditions.filter(c => c.ok).length;
    const sources = (item.sourceLinks || []).map(source =>
      `<a class="source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)} ↗</a>`
    ).join("");

    return `
      <article class="match-card ${index === 0 ? "recommended" : ""}">
        <div>
          <h3>${index === 0 ? "추천 1 · " : ""}${escapeHtml(item.name)}</h3>
          <div class="match-meta">${escapeHtml(item.type)} · ${escapeHtml(item.evidenceLevel || "")}</div>
          <p class="public-note">${escapeHtml(item.publicNote || "")}</p>
          <div class="condition-row">
            ${conditions.map(c => `<span class="condition ${c.ok ? "ok" : "miss"}">${c.ok ? "✓" : "!"} ${escapeHtml(c.label)}</span>`).join("")}
          </div>
          <div class="match-domains">겹치는 지원영역: <b>${item.matchedDomains.map(escapeHtml).join(", ") || "없음"}</b></div>
          <div class="source-links">${sources}</div>
        </div>
        <div class="match-side">
          <div class="score">${passed}<small> / ${conditions.length} 조건</small></div>
          <div class="intake">${escapeHtml(item.intake)}</div>
          <button class="choose-btn ${item.readyToSend ? "" : "warn"}" data-institution="${item.id}">
            ${item.readyToSend ? "인계서 생성" : "누락정보 확인"}
          </button>
        </div>
      </article>
    `;
  }).join("");

  $$("[data-institution]").forEach(btn => {
    btn.addEventListener("click", () => prepareHandoff(btn.dataset.institution, btn));
  });
}

function documentHtml(doc) {
  if (!doc) return "";
  return `
    <h3>${escapeHtml(doc.title || "기관 인계 요청")}</h3>
    <div class="doc-label">인계 사유</div>
    <div class="doc-text">${escapeHtml(doc.reason || "")}</div>
    <div class="doc-label">확인된 핵심 사실</div>
    <ul class="doc-list">${(doc.confirmed || []).map(v => `<li>${escapeHtml(v)}</li>`).join("")}</ul>
    <div class="doc-label">지원 필요</div>
    <div class="doc-text">${(doc.needs || []).map(escapeHtml).join(" · ") || "없음"}</div>
    <div class="doc-label">미확인 정보</div>
    <div class="doc-text">${(doc.unknowns || []).map(escapeHtml).join(" · ") || "없음"}</div>
    <div class="doc-label">최소정보 원칙</div>
    <div class="doc-text">${escapeHtml(doc.privacyNote || "담당자 검토 후 최소정보만 전송합니다.")}</div>
  `;
}

async function prepareHandoff(institutionId, button) {
  const institution = state.matches.find(item => item.id === institutionId);
  if (!institution) return;

  if (!institution.readyToSend) {
    const missing = institution.missing.length ? institution.missing.join(", ") : "연령/지역/지원영역 조건";
    toast(`인계 전 확인 필요: ${missing}`);
    return;
  }

  loading(button, true);
  try {
    const result = await api("/api/prepare-handoff", {
      method: "POST",
      body: JSON.stringify({ caseData: state.structured, institutionId })
    });
    state.selectedInstitution = institution;
    state.handoffDocument = result.document;
    $("#modalDocument").innerHTML = documentHtml(result.document);
    $("#handoffModal").classList.remove("hidden");
  } catch (error) {
    toast(error.message);
  } finally {
    loading(button, false);
  }
}

function renderTimeline(record) {
  $("#timeline").innerHTML = (record.timeline || []).map(item => `
    <div class="timeline-item">
      <b>${escapeHtml(item.label)}</b>
      <p>${escapeHtml(item.detail)}</p>
      <small>${escapeHtml(item.at)} · ${escapeHtml(item.actor)}</small>
    </div>
  `).join("");
}

function renderHandoffState(record) {
  state.caseRecord = record;
  $("#caseStatus").textContent = record.status;
  $("#currentOwner").textContent = record.currentOwner;
  $("#handoffDocument").innerHTML = documentHtml(record.handoffDocument || state.handoffDocument);
  renderTimeline(record);

  const actions = $("#handoffActions");
  const status = record.status;

  if (status === "기관 검토 중") {
    actions.innerHTML = `
      <button class="action-btn warn" id="supplementBtn">기관 응답: 보완 요청</button>
      <button class="action-btn" id="directRerouteBtn">기관 응답: 재연계 권고</button>
      <button class="action-btn primary" id="acceptBtn">기관 응답: 수락</button>
    `;
  } else if (status === "보완 요청") {
    actions.innerHTML = `
      <button class="action-btn primary" id="completeInfoBtn">현재 안전상태 확인 후 재제출</button>
    `;
  } else if (status === "기관 재검토 중") {
    actions.innerHTML = `
      <button class="action-btn warn" id="rerouteBtn">기관 응답: 가족지원 전문 연계 권고</button>
      <button class="action-btn primary" id="acceptBtn">기관 응답: 수락</button>
    `;
  } else if (status.includes("재라우팅")) {
    actions.innerHTML = `
      <button class="action-btn primary" id="acceptBtn">새 기관 응답: 책임 수락</button>
    `;
  } else {
    actions.innerHTML = "";
  }

  $("#successState").classList.toggle("hidden", status !== "주관기관 책임 수락");

  $("#supplementBtn")?.addEventListener("click", () => respond("supplement"));
  $("#directRerouteBtn")?.addEventListener("click", () => respond("reroute"));
  $("#rerouteBtn")?.addEventListener("click", () => respond("reroute"));
  $("#acceptBtn")?.addEventListener("click", () => respond("accept"));
  $("#completeInfoBtn")?.addEventListener("click", completeMissingInfo);
}

async function respond(action) {
  const buttons = $$("#handoffActions button");
  buttons.forEach(btn => btn.disabled = true);
  try {
    const result = await api(`/api/cases/${state.caseRecord.id}/respond`, {
      method: "POST",
      body: JSON.stringify({ action, caseData: state.structured })
    });
    renderHandoffState(result);
    toast(
      action === "supplement" ? "기관이 필요한 정보를 구조화해서 반환했습니다." :
      action === "reroute" ? "반려 사유를 재사용해 다음 기관으로 자동 재라우팅했습니다." :
      "주관기관 책임 수락이 기록되었습니다."
    );
  } catch (error) {
    toast(error.message);
    buttons.forEach(btn => btn.disabled = false);
  }
}

async function completeMissingInfo() {
  state.structured.safety = {
    status: "안정 확인",
    evidence: "담당자가 추가 면담에서 현재 즉각적 자해·자살 위험 표현이 없음을 확인함 (데모 입력)"
  };
  state.structured.unknowns = (state.structured.unknowns || []).filter(
    item => item.key !== "safetyStatus"
  );

  try {
    const result = await api(`/api/cases/${state.caseRecord.id}/respond`, {
      method: "POST",
      body: JSON.stringify({ action: "resubmit", caseData: state.structured })
    });
    renderHandoffState(result);
    toast("요청된 안전상태 정보만 보완해 재제출했습니다.");
  } catch (error) {
    toast(error.message);
  }
}

$("#sampleBtn").addEventListener("click", () => {
  $("#caseNote").value = sampleNote;
  $("#caseNote").focus();
});

$("#structureBtn").addEventListener("click", async () => {
  const note = $("#caseNote").value.trim();
  const btn = $("#structureBtn");
  const errorBox = $("#inputError");
  errorBox.classList.add("hidden");
  loading(btn, true);

  try {
    const result = await api("/api/structure", {
      method: "POST",
      body: JSON.stringify({ note })
    });
    state.structured = result.structured;
    renderStructure(state.structured);
    setStage(2);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  } finally {
    loading(btn, false);
  }
});

$("#confirmStructureBtn").addEventListener("click", async () => {
  const btn = $("#confirmStructureBtn");
  loading(btn, true);
  try {
    const result = await api("/api/match", {
      method: "POST",
      body: JSON.stringify({ caseData: state.structured })
    });
    state.matches = result.matches;
    renderMatches(result.matches);
    setStage(3);
  } catch (error) {
    toast(error.message);
  } finally {
    loading(btn, false);
  }
});

$("#closeModal").addEventListener("click", () => $("#handoffModal").classList.add("hidden"));
$("#cancelHandoff").addEventListener("click", () => $("#handoffModal").classList.add("hidden"));
$("#handoffModal").addEventListener("click", event => {
  if (event.target === $("#handoffModal")) $("#handoffModal").classList.add("hidden");
});

$("#sendHandoff").addEventListener("click", async () => {
  const btn = $("#sendHandoff");
  loading(btn, true);
  try {
    const result = await api("/api/handoff", {
      method: "POST",
      body: JSON.stringify({
        caseData: state.structured,
        institutionId: state.selectedInstitution.id,
        document: state.handoffDocument
      })
    });
    $("#handoffModal").classList.add("hidden");
    renderHandoffState(result);
    setStage(4);
    toast("인계 요청을 전송했습니다. 현재 책임자는 아직 학교 담당자입니다.");
  } catch (error) {
    toast(error.message);
  } finally {
    loading(btn, false);
  }
});

checkHealth();
$("#caseNote").value = sampleNote;
