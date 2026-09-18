const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const sampleNote = `마포구 소재 중학교 2학년 학생(만 14세)과 상담함.
최근 2주 동안 결석을 5번 했고, 친구들과 연락을 피하며 점심시간에도 혼자 있는 경우가 늘었다고 함.
집에서는 부모님과 거의 대화하지 않고 최근 가족 갈등이 잦다고 말함.
생활비 문제로 방과 후 활동 참여도 어렵다고 함.
자해나 죽고 싶은 생각이 있는지는 아직 확인하지 못했음.
학생에게 외부기관 최소정보 공유 취지를 설명했고, 학생이 정보공유에 동의함.`;

const state = {
  originalNote: "",
  structured: null,
  reviewContext: null,
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
  $("#originalNoteReview").value = state.originalNote || "";
  $("#summaryEditor").value = data.summary || "";
  $("#ageEditor").value = data.student?.age ?? "";
  $("#districtEditor").value = data.student?.district || "";
  $("#schoolStatusEditor").value = data.student?.schoolStatus || "미확인";
  $("#consentEditor").value = data.consent?.status || "미확인";
  $("#guardianConsentEditor").value = data.guardianConsent?.status || "미확인";
  $("#safetyEditor").value = data.safety?.status || "미확인";
  $("#needsEditor").value = (data.needs || []).map(item => item.area).join(", ");

  $("#factsEditor").innerHTML = (data.facts || []).length
    ? data.facts.map((item, index) => `
        <div class="repeat-editor-row fact-edit-row" data-index="${index}">
          <label>
            <span>확인된 사실</span>
            <input class="fact-label-input" type="text" value="${escapeHtml(item.label)}" />
          </label>
          <label>
            <span>원문 근거</span>
            <textarea class="fact-evidence-input editor-textarea" rows="2">${escapeHtml(item.evidence)}</textarea>
          </label>
        </div>`).join("")
    : `<div class="editor-empty">AI가 확인된 사실을 생성하지 않았습니다.</div>`;

  $("#unknownsEditor").innerHTML = (data.unknowns || []).length
    ? data.unknowns.map((item, index) => `
        <div class="repeat-editor-row unknown-edit-row" data-index="${index}" data-key="${escapeHtml(item.key || "other")}">
          <label>
            <span>확인할 정보</span>
            <input class="unknown-label-input" type="text" value="${escapeHtml(item.label)}" />
          </label>
          <label>
            <span>확인 이유</span>
            <textarea class="unknown-reason-input editor-textarea" rows="2">${escapeHtml(item.reason)}</textarea>
          </label>
        </div>`).join("")
    : `<div class="editor-empty">추가 확인 항목이 없습니다.</div>`;

  $("#editStatus").textContent = "AI 초안 · 검토 전";
  $("#structurePanel").querySelectorAll("input, textarea, select").forEach(control => {
    if (control.id === "originalNoteReview") return;
    control.addEventListener("input", markStructureEdited, { once: true });
    control.addEventListener("change", markStructureEdited, { once: true });
  });
}

function markStructureEdited() {
  $("#editStatus").textContent = "담당자 수정됨";
  $("#editStatus").classList.add("edited");
}

function syncStructureFromEditor() {
  const previous = state.structured || {};
  const ageRaw = $("#ageEditor").value.trim();
  const needAreas = $("#needsEditor").value
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  const previousNeedReasons = new Map(
    (previous.needs || []).map(item => [item.area, item.reason || "담당자 검토 후 입력"])
  );

  const facts = $$(".fact-edit-row").map(row => ({
    label: row.querySelector(".fact-label-input").value.trim(),
    evidence: row.querySelector(".fact-evidence-input").value.trim()
  })).filter(item => item.label || item.evidence);

  const unknowns = $$(".unknown-edit-row").map(row => ({
    key: row.dataset.key || "other",
    label: row.querySelector(".unknown-label-input").value.trim(),
    reason: row.querySelector(".unknown-reason-input").value.trim()
  })).filter(item => item.label || item.reason);

  state.structured = {
    ...previous,
    summary: $("#summaryEditor").value.trim(),
    student: {
      ...(previous.student || {}),
      age: ageRaw === "" ? null : Number(ageRaw),
      district: $("#districtEditor").value.trim() || null,
      schoolStatus: $("#schoolStatusEditor").value
    },
    facts,
    needs: needAreas.map(area => ({
      area,
      reason: previousNeedReasons.get(area) || "담당자가 구조화 결과를 수정함"
    })),
    unknowns,
    safety: {
      ...(previous.safety || {}),
      status: $("#safetyEditor").value
    },
    consent: {
      ...(previous.consent || {}),
      status: $("#consentEditor").value
    },
    guardianConsent: {
      ...(previous.guardianConsent || {}),
      status: $("#guardianConsentEditor").value
    }
  };

  $("#editStatus").textContent = "검토 반영 완료";
  $("#editStatus").classList.add("edited");
  return state.structured;
}

function renderInstitutionDataset(matches) {
  const order = ["youth-center", "mental-health", "family-center"];
  const rows = [...matches].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  $("#institutionDataset").innerHTML = rows.map(item => {
    const ageText = item.ages ? `만 ${item.ages[0]}~${item.ages[1]}세` : "공개자료상 별도 연령 제한 없음";
    const sources = (item.sourceLinks || []).map(source =>
      `<a class="dataset-source" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)} ↗</a>`
    ).join("");

    return `
      <article class="dataset-row">
        <div class="dataset-org">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.type)}</span>
        </div>
        <div class="dataset-cell">
          <span>대상 / 관할</span>
          <b>${escapeHtml(item.targetText || "")}</b>
          <small>${escapeHtml(ageText)} · ${escapeHtml((item.districts || []).join(", "))}</small>
        </div>
        <div class="dataset-cell">
          <span>지원·연계 범위</span>
          <b>${escapeHtml(item.serviceText || "")}</b>
          <small>정규화 영역 · ${(item.domains || []).map(escapeHtml).join(" · ")}</small>
        </div>
        <div class="dataset-cell">
          <span>이용·의뢰 조건</span>
          <b>${escapeHtml(item.referralText || item.intake || "")}</b>
          <small>${escapeHtml(item.phone || "")}</small>
        </div>
        <div class="dataset-sources">
          <span>원문 근거</span>
          <div>${sources}</div>
        </div>
      </article>
    `;
  }).join("");
}

function renderMatches(matches) {
  renderInstitutionDataset(matches);

  $("#matchesList").innerHTML = matches.map((item, index) => {
    const ageLabel = item.ages
      ? `연령 ${item.ages[0]}~${item.ages[1]}세`
      : "연령 제한 없음";
    const conditions = [
      { label: ageLabel, ok: item.ageOk },
      { label: `관할 ${(item.districts || []).join("/")}`, ok: item.regionOk },
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

function routeStateLabel(stateValue, type) {
  if (type === "source") return "사례 생성";
  return {
    reviewing: "현재 검토 중",
    supplement: "교사 보완 요청",
    transferred: "다음 기관으로 인계",
    accepted: "책임 수락"
  }[stateValue] || "인계";
}

function renderRouteMap(record) {
  const route = record.route || [];
  if (!route.length) {
    $("#routeMap").innerHTML = '<div class="route-empty">인계 경로가 아직 없습니다.</div>';
    return;
  }

  $("#routeMap").innerHTML = route.map((node, index) => {
    const isCurrent = index === route.length - 1 && node.type === "institution";
    const nodeClass = [
      "route-node",
      node.type === "source" ? "source" : "institution",
      node.state || "",
      isCurrent ? "current" : ""
    ].filter(Boolean).join(" ");

    const nodeHtml = `
      <div class="${nodeClass}">
        <div class="route-node-top">
          <span class="route-step">${node.type === "source" ? "START" : `0${index}`.slice(-2)}</span>
          <span class="route-state">${escapeHtml(routeStateLabel(node.state, node.type))}</span>
        </div>
        <strong>${escapeHtml(node.name)}</strong>
        <small>${node.type === "source" ? "발견·사례 생성" : (isCurrent ? "현재 검토기관" : "인계 경로")}</small>
      </div>
    `;

    if (index === 0) return nodeHtml;

    const reason = node.reason || "기관 인계";
    return `
      <div class="route-connector" title="${escapeHtml(reason)}">
        <span>→</span>
        <small>${escapeHtml(reason)}</small>
      </div>
      ${nodeHtml}
    `;
  }).join("");
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

function institutionTransferOptions(record) {
  return (state.matches || [])
    .filter(item => item.id !== record.currentInstitution?.id)
    .map(item => {
      const missingText = item.missing?.length ? ` · 확인 필요: ${item.missing.join(", ")}` : "";
      return `<option value="${item.id}">${escapeHtml(item.name)}${escapeHtml(missingText)}</option>`;
    })
    .join("");
}

function institutionResponseControls(record) {
  return `
    <div class="institution-actions">
      <div class="institution-current">
        <span>현재 검토기관</span>
        <strong>${escapeHtml(record.currentInstitution?.name || "")}</strong>
        <small>이 기관이 보완 요청·책임 수락·다른 기관 직접 인계를 결정합니다.</small>
      </div>
      <div class="institution-action-top">
        <button class="action-btn warn" id="supplementBtn">교사에게 보완 요청</button>
        <button class="action-btn primary" id="acceptBtn">이 기관이 책임 수락</button>
      </div>
      <div class="direct-transfer-card">
        <div class="direct-transfer-head">
          <div>
            <b>다른 기관에 직접 인계</b>
            <span>현재 기관이 더 적합한 기관을 직접 선택해 사례를 넘깁니다.</span>
          </div>
          <span class="institution-only-badge">기관 담당자 기능</span>
        </div>
        <label class="handoff-control">
          <span>인계 대상 기관</span>
          <select id="transferTargetSelect">
            <option value="">기관 선택</option>
            ${institutionTransferOptions(record)}
          </select>
        </label>
        <label class="handoff-control">
          <span>직접 인계 사유</span>
          <textarea id="transferReasonInput" rows="3" placeholder="예: 가족 갈등과 양육 지원 비중이 높아 가족상담·사례관리 기능을 가진 기관이 더 적합하다고 판단"></textarea>
        </label>
        <button class="action-btn direct-transfer-btn" id="directTransferBtn">선택 기관으로 직접 인계 →</button>
      </div>
    </div>
  `;
}

function renderHandoffState(record) {
  state.caseRecord = record;
  if (record.caseData) state.structured = record.caseData;
  $("#caseStatus").textContent = record.status;
  $("#currentOwner").textContent = record.currentOwner;
  $("#handoffDocument").innerHTML = documentHtml(record.handoffDocument || state.handoffDocument);
  renderRouteMap(record);
  renderTimeline(record);

  const actions = $("#handoffActions");
  const status = record.status;
  const institutionCanRespond =
    status === "기관 검토 중" ||
    status === "기관 재검토 중" ||
    status.includes("기관 직접 인계");

  if (institutionCanRespond) {
    actions.innerHTML = institutionResponseControls(record);
  } else if (status === "보완 요청") {
    actions.innerHTML = `
      <div class="teacher-return-card">
        <div>
          <b>교사 수정 대기</b>
          <span>${escapeHtml(record.pending?.message || "기관이 추가 확인을 요청했습니다.")}</span>
        </div>
        <button class="action-btn primary" id="teacherEditBtn">교사 수정 화면 열기 →</button>
      </div>
    `;
  } else {
    actions.innerHTML = "";
  }

  $("#successState").classList.toggle("hidden", status !== "주관기관 책임 수락");

  $("#supplementBtn")?.addEventListener("click", () => respond("supplement"));
  $("#acceptBtn")?.addEventListener("click", () => respond("accept"));
  $("#teacherEditBtn")?.addEventListener("click", openTeacherRevision);
  $("#directTransferBtn")?.addEventListener("click", directTransfer);
}

async function respond(action, extra = {}) {
  const buttons = $$("#handoffActions button");
  buttons.forEach(btn => btn.disabled = true);
  try {
    const result = await api(`/api/cases/${state.caseRecord.id}/respond`, {
      method: "POST",
      body: JSON.stringify({ action, caseData: state.structured, ...extra })
    });
    renderHandoffState(result);
    toast(
      action === "supplement"
        ? "기관이 사례를 교사에게 반환했습니다. 교사가 구조화 정보를 다시 수정할 수 있습니다."
        : "주관기관 책임 수락이 기록되었습니다."
    );
  } catch (error) {
    toast(error.message);
    buttons.forEach(btn => btn.disabled = false);
  }
}

function openTeacherRevision() {
  state.reviewContext = {
    mode: "resubmit",
    caseId: state.caseRecord.id,
    institutionName: state.caseRecord.currentInstitution?.name || "현재 기관"
  };
  if (state.caseRecord.caseData) state.structured = state.caseRecord.caseData;

  renderStructure(state.structured);
  $("#returnNotice").classList.remove("hidden");
  $("#returnNotice").innerHTML = `
    <b>${escapeHtml(state.reviewContext.institutionName)} 보완 요청</b>
    <span>${escapeHtml(state.caseRecord.pending?.message || "기관이 추가 확인을 요청했습니다.")}</span>
  `;
  $("#confirmStructureBtn").textContent = `수정사항 반영 · ${state.reviewContext.institutionName}에 재제출 →`;
  setStage(2);
}

async function directTransfer() {
  const targetInstitutionId = $("#transferTargetSelect")?.value || "";
  const reason = $("#transferReasonInput")?.value.trim() || "";
  if (!targetInstitutionId) {
    toast("직접 인계할 기관을 선택하세요.");
    return;
  }
  if (reason.length < 5) {
    toast("직접 인계 사유를 구체적으로 입력하세요.");
    return;
  }

  const button = $("#directTransferBtn");
  loading(button, true);
  try {
    const result = await api(`/api/cases/${state.caseRecord.id}/respond`, {
      method: "POST",
      body: JSON.stringify({
        action: "reroute",
        caseData: state.structured,
        targetInstitutionId,
        reason
      })
    });
    state.handoffDocument = result.handoffDocument;
    renderHandoffState(result);
    toast(`${result.currentInstitution.name}에 기관이 직접 인계했습니다.`);
  } catch (error) {
    toast(error.message);
  } finally {
    loading(button, false);
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
    state.originalNote = note;
    state.structured = result.structured;
    state.reviewContext = null;
    $("#returnNotice").classList.add("hidden");
    $("#returnNotice").innerHTML = "";
    $("#confirmStructureBtn").textContent = "수정사항 반영 · 기관 찾기 →";
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
    const reviewedCase = syncStructureFromEditor();

    if (state.reviewContext?.mode === "resubmit") {
      const caseId = state.reviewContext.caseId;
      const institutionName = state.reviewContext.institutionName;
      const result = await api(`/api/cases/${caseId}/respond`, {
        method: "POST",
        body: JSON.stringify({ action: "resubmit", caseData: reviewedCase })
      });
      const matchResult = await api("/api/match", {
        method: "POST",
        body: JSON.stringify({ caseData: reviewedCase })
      });
      state.matches = matchResult.matches;
      state.reviewContext = null;
      $("#returnNotice").classList.add("hidden");
      $("#returnNotice").innerHTML = "";
      $("#confirmStructureBtn").textContent = "수정사항 반영 · 기관 찾기 →";
      renderHandoffState(result);
      setStage(4);
      toast(`${institutionName}에 수정된 사례를 다시 제출했습니다.`);
      return;
    }

    const result = await api("/api/match", {
      method: "POST",
      body: JSON.stringify({ caseData: reviewedCase })
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
