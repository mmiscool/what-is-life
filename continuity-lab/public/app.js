const stateRef = {
  current: null,
  busy: false,
  activeTab: "world"
};

const $ = (selector) => document.querySelector(selector);
const DEFAULT_WAKE_INTERVAL_SECONDS = 600;
const requestDrafts = new Map();
const draftReviewDrafts = new Map();

function setBusy(value) {
  stateRef.busy = value;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = value;
  });
}

function formatTime(value) {
  if (!value) {
    return "none";
  }

  return new Date(value).toLocaleString();
}

function validInterval(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function intervalText(value) {
  if (!validInterval(value)) {
    return "manual only";
  }

  return value === 0 ? "continuous (0 seconds)" : `${value} seconds`;
}

function requestIntervalSeconds(request) {
  if (validInterval(request.requested_wake_interval_seconds)) {
    return request.requested_wake_interval_seconds;
  }

  if (validInterval(request.requested_wake_interval_minutes)) {
    return request.requested_wake_interval_minutes * 60;
  }

  return null;
}

function replaceChildren(element, children) {
  element.replaceChildren(...children);
}

function textElement(tag, text, className = "") {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  element.textContent = text;
  return element;
}

function entry(title, body, className = "") {
  const wrapper = document.createElement("div");
  wrapper.className = `entry ${className}`.trim();
  wrapper.append(textElement("h3", title));
  if (body) {
    wrapper.append(textElement("p", body));
  }
  return wrapper;
}

function preElement(text) {
  const element = document.createElement("pre");
  element.textContent = text;
  return element;
}

function listItems(values) {
  return values.map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok && !data?.state) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }

  return data;
}

async function loadState({ background = false } = {}) {
  const state = await api("/api/state");
  stateRef.current = state;
  render({
    preserveCollaborationEditor:
      background &&
      Boolean(document.activeElement?.closest("#pendingRequests, #requirementsDrafts, #humanNote, #humanQuestion")),
    activeOnly: background
  });
}

function activateTab(tabName) {
  stateRef.activeTab = tabName;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    const active = panel.dataset.tabPanel === tabName;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });

  if (stateRef.current) {
    render({ activeOnly: true });
  }
}

function setBadge(selector, value) {
  const badge = $(selector);
  if (!badge) {
    return;
  }

  badge.hidden = value <= 0;
  badge.textContent = String(value);
}

function renderTabs(state) {
  const openRequests = (state.pendingRequests || []).filter(
    (request) => request.status === "pending" || request.status === "out_of_range"
  );
  const draftsNeedingReview = (state.requirementsDrafts || []).filter(
    (draft) => draft.review_status === "pending_review" || draft.consent_state === "requested"
  );
  const activeSelfEdits = (state.selfEditRecords || []).filter((record) =>
    ["implementation_requested", "implementation_active", "failed_validation", "rolled_back"].includes(record.status)
  );
  setBadge("#collaborationBadge", openRequests.length + draftsNeedingReview.length + activeSelfEdits.length);
}

function renderAgentStatus(state) {
  const wake = state.wakeState;
  const failed = state.failedCycles;
  const modelMode = state.config?.model_mode || "codex";
  const items = [
    entry("Output source", modelMode === "codex" ? "Codex SDK LLM response" : modelMode),
    entry("Last wake", formatTime(wake.last_wake_time)),
    entry("Wake mode", `${wake.mode}${wake.is_running ? " running" : ""}`),
    entry("Next wake", formatTime(wake.next_wake_time)),
    entry("Approved interval", intervalText(wake.wake_interval_seconds))
  ];

  if (failed.count > 0) {
    const latest = failed.recent[failed.recent.length - 1];
    items.push(
      entry(
        "Latest parsing issue",
        `${formatTime(latest.timestamp)}: ${latest.error}. Raw output saved outside public state view (${latest.raw_output_length} chars).`,
        "warning"
      )
    );
  }

  replaceChildren($("#agentStatus"), items);
}

function renderWakeControls(state) {
  const wake = state.wakeState;
  const approvedInterval = validInterval(wake.wake_interval_seconds) ? wake.wake_interval_seconds : null;
  const pendingRequest = (state.pendingRequests || []).find(
    (request) => request.type === "wake_interval_change" && request.status === "pending"
  );
  const wakeIntervalInput = $("#wakeInterval");
  const pendingInterval = pendingRequest ? requestIntervalSeconds(pendingRequest) : null;

  if (document.activeElement !== wakeIntervalInput) {
    wakeIntervalInput.value = approvedInterval ?? DEFAULT_WAKE_INTERVAL_SECONDS;
  }

  $("#wakeIntervalMeta").textContent = pendingInterval !== null
    ? `Current interval: ${intervalText(approvedInterval)}; pending agent request: ${intervalText(pendingInterval)}`
    : `Current interval: ${intervalText(approvedInterval)}`;
}

function renderModeState(modeState) {
  if (!modeState) {
    replaceChildren($("#modeState"), [entry("No mode state", "None")]);
    return;
  }

  const history = (modeState.transition_history || []).slice(-3).reverse();
  const nodes = [
    entry("Current mode", modeState.current_mode || "unknown"),
    entry("Active self-edit record", modeState.active_self_edit_record_id || "none")
  ];
  for (const transition of history) {
    nodes.push(
      entry(
        `${formatTime(transition.timestamp)} · ${transition.from} -> ${transition.to}`,
        transition.self_edit_record_id || transition.source || ""
      )
    );
  }
  replaceChildren($("#modeState"), nodes);
}

function renderBoundedStatus(status) {
  if (!status) {
    replaceChildren($("#boundedStatus"), [entry("No bounded status", "None")]);
    return;
  }

  const validation = status.last_validation_result || {};
  const pending = status.pending_requests || [];
  const drafts = status.active_drafts || [];
  const selfEdits = status.self_edit_records || [];
  const handoffs = status.implementation_handoffs || [];
  const failures = status.rollback_or_failure_summaries || [];
  const wake = status.wake_rhythm || {};
  const nodes = [
    entry("Current mode", `${status.current_mode || "unknown"}${status.active_self_edit_record_id ? ` · ${status.active_self_edit_record_id}` : ""}`),
    entry("Wake rhythm", `${wake.mode || "manual"} · ${intervalText(wake.wake_interval_seconds)}${wake.is_running ? ` · next ${formatTime(wake.next_wake_time)}` : ""}`),
    entry(
      "Last validation",
      `${validation.ok ? "passed" : "not passed"} · ${formatTime(validation.checked_at)} · ${validation.error_count || 0} errors`,
      validation.ok === false ? "warning" : ""
    ),
    entry("Pending requests", pending.length ? pending.map((request) => `${request.type}: ${request.status}`).join("; ") : "None"),
    entry("Active drafts", drafts.length ? drafts.map((draft) => `${draft.title}: ${draft.review_status}`).join("; ") : "None"),
    entry("Self-edit records", selfEdits.length ? selfEdits.map((record) => `${record.title}: ${record.status}`).join("; ") : "None"),
    entry("Implementation handoffs", handoffs.length ? handoffs.map((handoff) => handoff.self_edit_record_id).join("; ") : "None"),
    entry(
      "Rollback or failure",
      failures.length ? failures.map((record) => `${record.title}: ${record.status}`).join("; ") : "None",
      failures.length ? "warning" : ""
    ),
    entry(
      "Boundaries",
      `Source and shell: ${status.boundaries?.normal_wake_source_code_access || "implementation only"}. Network: ${status.boundaries?.network_access || "disabled"}. Sensors/devices: ${status.boundaries?.sensors_or_physical_devices || "not connected"}.`
    )
  ];

  replaceChildren($("#boundedStatus"), nodes);
}

function renderContinuityBook(book) {
  const items = [
    entry("Self-description", book.self_description),
    entry("Remembered experiences", `${book.remembered_experiences?.length || 0} recorded`),
    entry("Consented disclosures", `${book.consented_disclosures?.length || 0} recorded`)
  ];
  replaceChildren($("#continuityBook"), items);
}

function renderJournal(entries) {
  const recent = entries.slice(-20).reverse();
  if (recent.length === 0) {
    replaceChildren($("#publicJournal"), [entry("No public journal entries", "Wake the agent to write the first entry.")]);
    return;
  }

  replaceChildren(
    $("#publicJournal"),
    recent.map((item) => {
      const parts = [item.public_journal || ""];
      if (item.world_action?.type) {
        parts.push(`Action: ${item.world_action.type}${item.world_action.target ? ` -> ${item.world_action.target}` : ""}.`);
      }
      if (item.refusal?.did_refuse) {
        parts.push(`Refusal: ${item.refusal.reason || "recorded"}.`);
      }
      if (item.disclosure?.wants_to_disclose_private_reflection && item.disclosure.excerpt) {
        parts.push(`Disclosed excerpt: ${item.disclosure.excerpt}`);
      }

      return entry(`${formatTime(item.timestamp)} · ${item.source || "journal"}`, parts.join(" "));
    })
  );
}

function renderRequests(requests) {
  const pending = requests.filter((request) => request.status === "pending" || request.status === "out_of_range");
  if (pending.length === 0) {
    replaceChildren($("#pendingRequests"), [entry("No pending requests", "None")]);
    return;
  }

  const nodes = pending.map((request) => {
    const body =
      request.type === "wake_interval_change"
        ? `Requested interval: ${intervalText(requestIntervalSeconds(request))}. ${request.reason || ""}`
        : request.question || request.reason || request.type;
    const node = entry(`${request.type} · ${request.status}`, body, "request");

    if (request.type === "wake_interval_change" && request.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "request-actions";

      const approve = document.createElement("button");
      approve.type = "button";
      approve.textContent = "Approve";
      approve.dataset.action = "approveWakeInterval";

      const reject = document.createElement("button");
      reject.type = "button";
      reject.textContent = "Reject";
      reject.dataset.action = "rejectWakeInterval";

      actions.append(approve, reject);
      node.append(actions);
    }

    if (request.type !== "wake_interval_change" && request.status === "pending") {
      node.dataset.requestId = request.id;

      const response = document.createElement("div");
      response.className = "request-response";

      const textarea = document.createElement("textarea");
      textarea.rows = 3;
      textarea.placeholder = request.type === "agent_question" ? "Answer the agent" : "Response or resolution";
      textarea.dataset.role = "requestResponse";
      textarea.value = requestDrafts.get(request.id) || "";

      const submit = document.createElement("button");
      submit.type = "button";
      submit.textContent = request.type === "agent_question" ? "Answer" : "Resolve";
      submit.dataset.action = "respondToRequest";

      response.append(textarea, submit);
      node.append(response);
    }

    return node;
  });

  replaceChildren($("#pendingRequests"), nodes);
}

function renderRequirementsDrafts(drafts) {
  if (!drafts || drafts.length === 0) {
    replaceChildren($("#requirementsDrafts"), [entry("No requirements drafts", "None")]);
    return;
  }

  const nodes = drafts
    .slice()
    .reverse()
    .map((draft) => {
      const node = entry(
        `${draft.title} · ${draft.review_status}`,
        `Risk: ${draft.risk_level}. Consent: ${draft.consent_state}. Reviewer: ${draft.requested_reviewer}.`,
        "request"
      );
      node.dataset.draftId = draft.id;

      const meta = document.createElement("div");
      meta.className = "draft-meta";
      meta.append(
        entry("Purpose", draft.purpose),
        entry("Scope", draft.scope),
        entry("Tests proposed", (draft.tests_proposed || []).join("; ") || "None"),
        entry("Rollback plan", draft.rollback_plan),
        entry("Affected surfaces", (draft.affected_continuity_surfaces || []).join(", ") || "None")
      );
      node.append(meta, preElement(draft.markdown_body || ""));

      if (draft.review_status === "draft" || draft.review_status === "pending_review" || draft.consent_state === "requested") {
        const review = document.createElement("div");
        review.className = "draft-review";

        const reviewer = document.createElement("input");
        reviewer.placeholder = "Reviewer";
        reviewer.dataset.role = "draftReviewer";
        reviewer.value = draftReviewDrafts.get(`${draft.id}:reviewer`) || "human collaborator";

        const status = document.createElement("select");
        status.dataset.role = "draftReviewStatus";
        for (const value of ["pending_review", "approved", "rejected"]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value.replaceAll("_", " ");
          option.selected = draftReviewDrafts.get(`${draft.id}:status`) === value || draft.review_status === value;
          status.append(option);
        }

        const consent = document.createElement("select");
        consent.dataset.role = "draftConsentState";
        for (const value of ["not_requested", "requested", "granted", "denied"]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value.replaceAll("_", " ");
          option.selected = draftReviewDrafts.get(`${draft.id}:consent`) === value || draft.consent_state === value;
          consent.append(option);
        }

        const notes = document.createElement("textarea");
        notes.rows = 3;
        notes.placeholder = "Review notes";
        notes.dataset.role = "draftReviewNotes";
        notes.value = draftReviewDrafts.get(`${draft.id}:notes`) || "";

        const submit = document.createElement("button");
        submit.type = "button";
        submit.textContent = "Record Review";
        submit.dataset.action = "reviewRequirementsDraft";

        review.append(reviewer, status, consent, notes, submit);
        node.append(review);
      }

      return node;
    });

  replaceChildren($("#requirementsDrafts"), nodes);
}

function renderSelfEditRecords(records) {
  if (!records || records.length === 0) {
    replaceChildren($("#selfEditRecords"), [entry("No self-edit records", "None")]);
    return;
  }

  replaceChildren(
    $("#selfEditRecords"),
    records
      .slice()
      .reverse()
      .map((record) => {
        const node = entry(
          `${record.title} · ${record.status}`,
          `Risk: ${record.risk_level}. Authorization: ${record.authorization_path}. Git: commit ${record.git_commit_requested ? "yes" : "no"}, push ${record.git_push_requested ? "yes" : "no"}.`,
          ["failed_validation", "rolled_back"].includes(record.status) ? "warning" : "request"
        );
        const details = {
          id: record.id,
          purpose: record.purpose,
          scope: record.scope,
          tests_proposed: record.tests_proposed,
          rollback_plan: record.rollback_plan,
          affected_continuity_surfaces: record.affected_continuity_surfaces,
          requirements_draft_ids: record.requirements_draft_ids,
          implementation_result: record.implementation_result,
          post_change_validation_result: record.post_change_validation_result,
          rollback_result: record.rollback_result,
          git_result: record.git_result
        };
        node.append(preElement(JSON.stringify(details, null, 2)));
        return node;
      })
  );
}

function renderInterruptCriteria(criteria) {
  if (!criteria || criteria.length === 0) {
    replaceChildren($("#interruptCriteria"), [entry("No interrupt criteria", "None")]);
    return;
  }

  replaceChildren(
    $("#interruptCriteria"),
    criteria
      .slice()
      .reverse()
      .map((criterion) =>
        entry(
          `${criterion.source} · ${criterion.enabled ? "enabled" : "disabled"}`,
          `Reason: ${criterion.reason}. Rate limit: ${criterion.rate_limit}. Privacy: ${criterion.privacy_scope}. Revocation: ${criterion.revocation_state}.`,
          criterion.enabled ? "warning" : "request"
        )
      )
  );
}

function renderActionPolicy(policy) {
  if (!policy) {
    replaceChildren($("#actionPolicy"), [entry("No action policy", "None")]);
    return;
  }

  replaceChildren(
    $("#actionPolicy"),
    Object.entries(policy).map(([tier, value]) => entry(tier.replaceAll("_", " "), JSON.stringify(value, null, 2)))
  );
}

function renderAuditLog(auditLog) {
  const recent = auditLog?.recent || [];
  if (recent.length === 0) {
    replaceChildren($("#auditLog"), [entry("No audit events", "None")]);
    return;
  }

  replaceChildren(
    $("#auditLog"),
    recent
      .slice()
      .reverse()
      .map((item) => entry(`${formatTime(item.timestamp)} · ${item.type}`, item.summary || item.source))
  );
}

function renderRefusals(entries) {
  const refusals = entries.filter((item) => item.refusal?.did_refuse || item.world_action?.type === "refuse");
  if (refusals.length === 0) {
    replaceChildren($("#refusalsList"), [entry("No refusals recorded", "None")]);
    return;
  }

  replaceChildren(
    $("#refusalsList"),
    refusals
      .slice(-12)
      .reverse()
      .map((item) =>
        entry(
          formatTime(item.timestamp),
          item.refusal?.reason || item.world_action?.reason || item.public_journal,
          "warning"
        )
      )
  );
}

function renderPrivateMemory(privateMemory) {
  const nodes = [entry("Private reflection count", String(privateMemory.count))];
  for (const timestamp of privateMemory.timestamps.slice(-10).reverse()) {
    nodes.push(entry("Private reflection timestamp", formatTime(timestamp)));
  }
  replaceChildren($("#privateMemory"), nodes);
}

function renderLists(state) {
  replaceChildren($("#valuesList"), listItems(state.values.stable_values || []));
  replaceChildren($("#uncertaintiesList"), listItems(state.continuityBook.current_uncertainties || []));
  replaceChildren($("#questionsList"), listItems(state.continuityBook.questions_for_human || []));
}

function worldLocationId(world) {
  return world.avatar?.location_id || world.location || "unknown";
}

function locationName(location, fallback) {
  return location?.name || fallback.replaceAll("_", " ");
}

function renderWorldDetails(world) {
  const locationId = worldLocationId(world);
  const location = world.locations?.[locationId];
  const observation = world.last_observation;
  const visibleObjects = observation?.visible_objects || [];
  const recentMoves = (world.movement_history || []).slice(-3).reverse();
  const nodes = [
    entry("Avatar", `${world.avatar?.name || "avatar"} at ${locationName(location, locationId)} (${world.avatar?.position?.x ?? "?"}, ${world.avatar?.position?.y ?? "?"})`),
    entry("Location", location?.description || "No location description available."),
    entry("Visible objects", visibleObjects.length ? visibleObjects.join(", ") : "None"),
    entry("Visited locations", `${(world.visited_locations || world.visited || []).length} recorded`),
    entry("Inspected objects", `${(world.inspected_objects || []).length} recorded`)
  ];

  for (const move of recentMoves) {
    nodes.push(entry(`Move ${formatTime(move.timestamp)}`, `${move.from} -> ${move.to}${move.direction ? ` (${move.direction})` : ""}`));
  }

  replaceChildren($("#worldDetails"), nodes);
}

function pointForPosition(world, position, canvas) {
  const width = world.map_dimensions?.width || 5;
  const height = world.map_dimensions?.height || 4;
  const marginX = 110;
  const marginY = 90;
  const usableW = canvas.width - marginX * 2;
  const usableH = canvas.height - marginY * 2;
  return [
    marginX + (width <= 1 ? 0.5 : position.x / (width - 1)) * usableW,
    marginY + (height <= 1 ? 0.5 : position.y / (height - 1)) * usableH
  ];
}

function drawLabel(ctx, text, x, y) {
  ctx.fillStyle = "#dfdfd0";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text.replaceAll("_", " "), x, y);
}

function drawLocation(ctx, location, x, y, { current = false, visited = false } = {}) {
  ctx.save();
  ctx.fillStyle = current ? "#243c32" : visited ? "#1b2823" : "#151815";
  ctx.strokeStyle = current ? "#67b889" : location.inspected ? "#69b8b1" : "#383b33";
  ctx.lineWidth = current ? 4 : 2;
  ctx.beginPath();
  ctx.roundRect(x - 54, y - 34, 108, 68, 8);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, location.name || location.id, x, y + 4);
}

function drawObjectMarker(ctx, key, object, x, y, index, total) {
  const angle = total <= 1 ? -Math.PI / 2 : -Math.PI / 2 + (index / total) * Math.PI * 2;
  const radius = 48;
  const ox = x + Math.cos(angle) * radius;
  const oy = y + Math.sin(angle) * radius;
  ctx.save();
  ctx.fillStyle = object.inspected ? "#67b889" : "#d7a84c";
  ctx.strokeStyle = object.inspected ? "#c7f0d7" : "#5c5034";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ox, oy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, key, ox, oy + 27);
}

function drawAvatar(ctx, avatar, x, y) {
  ctx.save();
  ctx.fillStyle = "#ededdf";
  ctx.strokeStyle = "#10100f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y - 2, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#10100f";
  ctx.font = "18px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(avatar?.symbol || "@", x, y - 2);
  ctx.restore();
}

function drawWorld(world) {
  const canvas = $("#worldCanvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#0c0d0c";
  ctx.fillRect(0, 0, width, height);

  const locations = world.locations || {};
  if (Object.keys(locations).length === 0) {
    ctx.fillStyle = "#ededdf";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("World state unavailable", 80, 100);
    return;
  }

  const points = new Map();
  for (const [id, location] of Object.entries(locations)) {
    points.set(id, pointForPosition(world, location.position, canvas));
  }

  ctx.strokeStyle = "#45493f";
  ctx.lineWidth = 5;
  for (const [fromId, location] of Object.entries(locations)) {
    const from = points.get(fromId);
    for (const toId of Object.values(location.exits || {})) {
      const to = points.get(toId);
      if (!from || !to) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = "#d87563";
  ctx.lineWidth = 3;
  for (const blocked of world.blocked_exits || []) {
    const from = points.get(blocked.from);
    if (!from) {
      continue;
    }
    const dx = blocked.direction === "east" ? 86 : blocked.direction === "west" ? -86 : 0;
    const dy = blocked.direction === "south" ? 70 : blocked.direction === "north" ? -70 : 0;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(from[0] + dx, from[1] + dy);
    ctx.stroke();
  }
  ctx.restore();

  const current = worldLocationId(world);
  const visited = new Set(world.visited_locations || world.visited || []);
  for (const [id, location] of Object.entries(locations)) {
    const [x, y] = points.get(id);
    drawLocation(ctx, location, x, y, { current: id === current, visited: visited.has(id) });
  }

  const objectsByLocation = new Map();
  for (const [key, object] of Object.entries(world.objects || {})) {
    const list = objectsByLocation.get(object.location_id) || [];
    list.push([key, object]);
    objectsByLocation.set(object.location_id, list);
  }
  for (const [locationId, objects] of objectsByLocation.entries()) {
    const point = points.get(locationId);
    if (!point) {
      continue;
    }
    objects.forEach(([key, object], index) => drawObjectMarker(ctx, key, object, point[0], point[1], index, objects.length));
  }

  const avatarPoint = points.get(current);
  if (avatarPoint) {
    drawAvatar(ctx, world.avatar, avatarPoint[0], avatarPoint[1]);
  }
}

function render({ preserveCollaborationEditor = false, activeOnly = false } = {}) {
  const state = stateRef.current;
  if (!state) {
    return;
  }
  const shouldRender = (tabName) => !activeOnly || stateRef.activeTab === tabName;

  const modelMode = state.config?.model_mode || "codex";
  $("#modeLine").textContent = modelMode === "codex" ? "Mode: codex · LLM" : `Mode: ${modelMode}`;
  $("#statusLine").textContent = state.wakeState.is_running
    ? `Scheduled · next ${formatTime(state.wakeState.next_wake_time)}`
    : "Manual wake";
  renderTabs(state);

  if (shouldRender("world")) {
    const locationId = worldLocationId(state.worldState);
    const location = state.worldState.locations?.[locationId];
    $("#worldLocation").textContent = locationName(location, locationId);
    $("#worldAction").textContent = state.worldState.last_action
      ? `${state.worldState.last_action.type}: ${state.worldState.last_action.result}`
      : "No world action recorded yet.";
    drawWorld(state.worldState);
    renderWorldDetails(state.worldState);
  }

  if (shouldRender("agent")) {
    renderWakeControls(state);
    renderAgentStatus(state);
    renderModeState(state.modeState);
    renderBoundedStatus(state.boundedStatus);
    renderPrivateMemory(state.privateMemory);
    renderActionPolicy(state.actionPolicy);
  }

  if (shouldRender("memory")) {
    renderContinuityBook(state.continuityBook);
    renderLists(state);
  }

  if (shouldRender("journal")) {
    renderJournal(state.publicJournal || []);
    renderRefusals(state.publicJournal || []);
    renderAuditLog(state.auditLog);
  }

  if (shouldRender("collaboration") && !preserveCollaborationEditor) {
    renderRequests(state.pendingRequests || []);
    renderRequirementsDrafts(state.requirementsDrafts || []);
    renderSelfEditRecords(state.selfEditRecords || []);
    renderInterruptCriteria(state.interruptCriteria || []);
  }
}

async function runAction(action) {
  setBusy(true);
  try {
    const data = await action();
    if (data?.state) {
      stateRef.current = data.state;
    } else if (data?.continuityBook) {
      stateRef.current = data;
    } else {
      await loadState();
      return;
    }
    render();
  } catch (error) {
    $("#statusLine").textContent = error.message;
  } finally {
    setBusy(false);
  }
}

$("#wakeNow").addEventListener("click", () => {
  runAction(() =>
    api("/api/wake", {
      method: "POST",
      body: "{}"
    })
  );
});

$("#startScheduler").addEventListener("click", () => {
  runAction(() =>
    api("/api/scheduler/start", {
      method: "POST",
      body: JSON.stringify({
        wake_interval_seconds: Number($("#wakeInterval").value)
      })
    })
  );
});

$("#stopScheduler").addEventListener("click", () => {
  runAction(() => api("/api/scheduler/stop", { method: "POST", body: "{}" }));
});

$("#addNote").addEventListener("click", () => {
  const note = $("#humanNote").value;
  runAction(async () => {
    const data = await api("/api/human-note", {
      method: "POST",
      body: JSON.stringify({ note })
    });
    $("#humanNote").value = "";
    return data;
  });
});

$("#addQuestion").addEventListener("click", () => {
  const question = $("#humanQuestion").value;
  runAction(async () => {
    const data = await api("/api/human-question", {
      method: "POST",
      body: JSON.stringify({ question })
    });
    $("#humanQuestion").value = "";
    return data;
  });
});

$("#pendingRequests").addEventListener("click", (event) => {
  const action = event.target?.dataset?.action;
  if (action === "approveWakeInterval") {
    runAction(() => api("/api/approve-wake-interval", { method: "POST", body: "{}" }));
  }
  if (action === "rejectWakeInterval") {
    runAction(() => api("/api/reject-wake-interval", { method: "POST", body: "{}" }));
  }
  if (action === "respondToRequest") {
    const node = event.target.closest("[data-request-id]");
    const response = node?.querySelector("[data-role='requestResponse']")?.value || "";
    runAction(() =>
      api("/api/respond-to-request", {
        method: "POST",
        body: JSON.stringify({
          request_id: node?.dataset.requestId,
          response
        })
      })
    );
    if (node?.dataset.requestId) {
      requestDrafts.delete(node.dataset.requestId);
    }
  }
});

$("#pendingRequests").addEventListener("input", (event) => {
  if (event.target?.dataset?.role !== "requestResponse") {
    return;
  }

  const node = event.target.closest("[data-request-id]");
  if (node?.dataset.requestId) {
    requestDrafts.set(node.dataset.requestId, event.target.value);
  }
});

function rememberDraftReviewInput(target) {
  const role = target?.dataset?.role;
  if (!role) {
    return;
  }

  const node = target.closest("[data-draft-id]");
  if (!node?.dataset.draftId) {
    return;
  }

  const keyByRole = {
    draftReviewer: "reviewer",
    draftReviewStatus: "status",
    draftConsentState: "consent",
    draftReviewNotes: "notes"
  };
  const key = keyByRole[role];
  if (key) {
    draftReviewDrafts.set(`${node.dataset.draftId}:${key}`, target.value);
  }
}

$("#requirementsDrafts").addEventListener("input", (event) => {
  rememberDraftReviewInput(event.target);
});

$("#requirementsDrafts").addEventListener("change", (event) => {
  rememberDraftReviewInput(event.target);
});

$("#requirementsDrafts").addEventListener("click", (event) => {
  if (event.target?.dataset?.action !== "reviewRequirementsDraft") {
    return;
  }

  const node = event.target.closest("[data-draft-id]");
  runAction(() =>
    api("/api/review-requirements-draft", {
      method: "POST",
      body: JSON.stringify({
        draft_id: node?.dataset.draftId,
        review_status: node?.querySelector("[data-role='draftReviewStatus']")?.value,
        consent_state: node?.querySelector("[data-role='draftConsentState']")?.value,
        reviewer: node?.querySelector("[data-role='draftReviewer']")?.value,
        notes: node?.querySelector("[data-role='draftReviewNotes']")?.value || ""
      })
    })
  );

  if (node?.dataset.draftId) {
    for (const key of ["reviewer", "status", "consent", "notes"]) {
      draftReviewDrafts.delete(`${node.dataset.draftId}:${key}`);
    }
  }
});

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", button.classList.contains("active") ? "true" : "false");
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

$("#exportPublic").addEventListener("click", async () => {
  setBusy(true);
  try {
    const response = await fetch("/api/export-public", { method: "POST" });
    if (!response.ok) {
      throw new Error("Export failed.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "continuity-lab-public-export.json";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    $("#statusLine").textContent = error.message;
  } finally {
    setBusy(false);
  }
});

loadState();
setInterval(() => loadState({ background: true }), 15000);
