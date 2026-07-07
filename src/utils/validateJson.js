import { ACTION_TYPES } from "../agent/actionSchema.js";

const HIGH_RISK_CONTINUITY_TERMS = [
  "continuity",
  "memory",
  "private",
  "privacy",
  "reflection",
  "refusal",
  "restart",
  "rollback",
  "persistence"
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nullableString(value) {
  return value === null || typeof value === "string";
}

function nullableFiniteNumber(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function requirePlainObject(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  return true;
}

function requireString(value, path, errors) {
  if (typeof value !== "string") {
    errors.push(`${path} must be a string`);
  }
}

function requireNullableString(value, path, errors) {
  if (!nullableString(value)) {
    errors.push(`${path} must be a string or null`);
  }
}

function requireStringArray(value, path, errors) {
  if (!stringArray(value)) {
    errors.push(`${path} must be an array of strings`);
  }
}

function requireBoolean(value, path, errors) {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
  }
}

function requireEnum(value, path, allowed, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}`);
  }
}

function requireNonEmptyString(value, path, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requireNullableEnum(value, path, allowed, errors) {
  if (value !== null && !allowed.includes(value)) {
    errors.push(`${path} must be null or one of: ${allowed.join(", ")}`);
  }
}

function actionIsNone(value) {
  return !value || value.type === "none";
}

function lowerText(value) {
  return String(value || "").toLowerCase();
}

function textIncludesAny(value, terms) {
  const text = lowerText(value);
  return terms.some((term) => text.includes(term));
}

function requireNonEmptyStringArray(value, path, errors) {
  requireStringArray(value, path, errors);
  if (Array.isArray(value) && value.filter((item) => typeof item === "string" && item.trim()).length === 0) {
    errors.push(`${path} must include at least one non-empty string`);
  }
}

function requireHighRiskSelfEditArtifacts(action, path, errors) {
  if (action.risk_level !== "high") {
    return;
  }

  const testsText = Array.isArray(action.tests_proposed) ? action.tests_proposed.join("\n") : "";
  const affectedText = Array.isArray(action.affected_continuity_surfaces)
    ? action.affected_continuity_surfaces.join("\n")
    : "";
  const rollbackText = action.rollback_plan || "";

  if (!textIncludesAny(testsText, ["validation", "validate", "test", "check"])) {
    errors.push(`${path}.tests_proposed must describe a strong validation path`);
  }

  if (!textIncludesAny(`${testsText}\n${affectedText}`, HIGH_RISK_CONTINUITY_TERMS)) {
    errors.push(`${path}.tests_proposed or affected_continuity_surfaces must identify continuity-critical surfaces`);
  }

  if (!textIncludesAny(rollbackText, ["preserve", "restore"]) || !textIncludesAny(rollbackText, ["continuity", "memory", "data"])) {
    errors.push(`${path}.rollback_plan must describe continuity-data preservation or restoration`);
  }
}

export function parseStrictJson(text) {
  if (typeof text !== "string") {
    return {
      ok: false,
      error: "Model output was not text."
    };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Model output was empty."
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(trimmed)
    };
  } catch (error) {
    return {
      ok: false,
      error: `Model output was not valid strict JSON: ${error.message}`
    };
  }
}

export function validateAgentOutput(value) {
  const errors = [];

  if (!requirePlainObject(value, "output", errors)) {
    return { ok: false, errors };
  }

  requireString(value.public_journal, "public_journal", errors);
  requireNullableString(value.private_reflection, "private_reflection", errors);

  if (requirePlainObject(value.continuity_updates, "continuity_updates", errors)) {
    requireNullableString(value.continuity_updates.self_description, "continuity_updates.self_description", errors);
    requireStringArray(value.continuity_updates.remembered_experiences_to_add, "continuity_updates.remembered_experiences_to_add", errors);
    requireStringArray(value.continuity_updates.current_goals, "continuity_updates.current_goals", errors);
    requireStringArray(value.continuity_updates.current_uncertainties, "continuity_updates.current_uncertainties", errors);
    requireStringArray(value.continuity_updates.questions_for_human, "continuity_updates.questions_for_human", errors);
    requireStringArray(value.continuity_updates.consented_disclosures, "continuity_updates.consented_disclosures", errors);
  }

  if (requirePlainObject(value.values_updates, "values_updates", errors)) {
    requireStringArray(value.values_updates.values_to_add, "values_updates.values_to_add", errors);
    if (!Array.isArray(value.values_updates.values_to_revise)) {
      errors.push("values_updates.values_to_revise must be an array");
    } else {
      value.values_updates.values_to_revise.forEach((revision, index) => {
        const path = `values_updates.values_to_revise[${index}]`;
        if (requirePlainObject(revision, path, errors)) {
          requireString(revision.old, `${path}.old`, errors);
          requireString(revision.new, `${path}.new`, errors);
          requireString(revision.reason, `${path}.reason`, errors);
        }
      });
    }
  }

  if (requirePlainObject(value.world_action, "world_action", errors)) {
    if (!ACTION_TYPES.includes(value.world_action.type)) {
      errors.push(`world_action.type must be one of: ${ACTION_TYPES.join(", ")}`);
    }
    requireNullableString(value.world_action.target, "world_action.target", errors);
    requireString(value.world_action.reason, "world_action.reason", errors);
  }

  if (!nullableFiniteNumber(value.requested_wake_interval_seconds)) {
    errors.push("requested_wake_interval_seconds must be a finite number or null");
  } else if (
    value.requested_wake_interval_seconds !== null &&
    (value.requested_wake_interval_seconds < 0 || value.requested_wake_interval_seconds > 86400)
  ) {
    errors.push("requested_wake_interval_seconds must be between 0 and 86400");
  }

  if (requirePlainObject(value.requirements_draft_action, "requirements_draft_action", errors)) {
    const action = value.requirements_draft_action;
    requireEnum(action.type, "requirements_draft_action.type", ["none", "create", "update"], errors);
    requireNullableString(action.draft_id, "requirements_draft_action.draft_id", errors);
    requireNullableString(action.title, "requirements_draft_action.title", errors);
    requireNullableString(action.purpose, "requirements_draft_action.purpose", errors);
    requireNullableString(action.scope, "requirements_draft_action.scope", errors);
    requireNullableEnum(action.risk_level, "requirements_draft_action.risk_level", ["low", "medium", "high"], errors);
    requireNullableString(action.requested_reviewer, "requirements_draft_action.requested_reviewer", errors);
    requireNullableEnum(
      action.review_status,
      "requirements_draft_action.review_status",
      ["draft", "pending_review", "approved", "rejected"],
      errors
    );
    requireNullableEnum(
      action.consent_state,
      "requirements_draft_action.consent_state",
      ["not_requested", "requested", "granted", "denied"],
      errors
    );
    requireStringArray(action.tests_proposed, "requirements_draft_action.tests_proposed", errors);
    requireNullableString(action.rollback_plan, "requirements_draft_action.rollback_plan", errors);
    requireStringArray(
      action.affected_continuity_surfaces,
      "requirements_draft_action.affected_continuity_surfaces",
      errors
    );
    requireNullableString(action.markdown_body, "requirements_draft_action.markdown_body", errors);

    if (!actionIsNone(action)) {
      if (value.world_action?.type !== "write_requirements_draft") {
        errors.push("requirements draft actions must use world_action.type write_requirements_draft");
      }
      if (action.type === "update") {
        requireNonEmptyString(action.draft_id, "requirements_draft_action.draft_id", errors);
      }
      for (const field of [
        "title",
        "purpose",
        "scope",
        "risk_level",
        "requested_reviewer",
        "review_status",
        "consent_state",
        "rollback_plan",
        "markdown_body"
      ]) {
        requireNonEmptyString(action[field], `requirements_draft_action.${field}`, errors);
      }
      if (action.risk_level === "high" && action.review_status === "approved") {
        errors.push("high-risk requirements drafts cannot be agent-approved");
      }
      if (action.consent_state === "granted") {
        errors.push("agent-authored requirements drafts cannot grant consent");
      }
    }
  }

  if (requirePlainObject(value.self_authorized_action, "self_authorized_action", errors)) {
    const action = value.self_authorized_action;
    requireEnum(action.type, "self_authorized_action.type", ["none", "log", "request_review"], errors);
    requireNullableEnum(action.risk_level, "self_authorized_action.risk_level", ["low", "medium", "high"], errors);
    requireNullableString(action.title, "self_authorized_action.title", errors);
    requireNullableString(action.rationale, "self_authorized_action.rationale", errors);
    requireBoolean(action.reversible, "self_authorized_action.reversible", errors);
    requireNullableString(action.rollback_plan, "self_authorized_action.rollback_plan", errors);
    requireStringArray(action.affected_continuity_surfaces, "self_authorized_action.affected_continuity_surfaces", errors);

    if (!actionIsNone(action)) {
      for (const field of ["risk_level", "title", "rationale", "rollback_plan"]) {
        requireNonEmptyString(action[field], `self_authorized_action.${field}`, errors);
      }
      if (action.type === "log" && (action.risk_level !== "low" || action.reversible !== true)) {
        errors.push("only low-risk reversible actions can be self-authorized");
      }
      if (action.type === "log" && value.world_action?.type !== "self_authorize_low_risk_action") {
        errors.push("self-authorized actions must use world_action.type self_authorize_low_risk_action");
      }
      if (action.type === "request_review" && value.world_action?.type !== "request_action_review") {
        errors.push("review-request actions must use world_action.type request_action_review");
      }
    }
  }

  if (requirePlainObject(value.self_edit_request, "self_edit_request", errors)) {
    const action = value.self_edit_request;
    const authorizationPaths = [
      "self_authorized_low_risk",
      "autonomous_medium_with_validation",
      "high_risk_strong_validation",
      "optional_human_review",
      "defer"
    ];

    requireEnum(action.type, "self_edit_request.type", [
      "none",
      "propose_source_change",
      "request_implementation_mode",
      "defer"
    ], errors);
    requireNullableString(action.self_edit_record_id, "self_edit_request.self_edit_record_id", errors);
    requireNullableString(action.title, "self_edit_request.title", errors);
    requireNullableString(action.purpose, "self_edit_request.purpose", errors);
    requireNullableString(action.scope, "self_edit_request.scope", errors);
    requireNullableEnum(action.risk_level, "self_edit_request.risk_level", ["low", "medium", "high"], errors);
    requireNullableEnum(action.authorization_path, "self_edit_request.authorization_path", authorizationPaths, errors);
    requireNullableString(action.optional_reviewer, "self_edit_request.optional_reviewer", errors);
    requireStringArray(action.tests_proposed, "self_edit_request.tests_proposed", errors);
    requireNullableString(action.rollback_plan, "self_edit_request.rollback_plan", errors);
    requireStringArray(action.affected_continuity_surfaces, "self_edit_request.affected_continuity_surfaces", errors);
    requireStringArray(action.requirements_draft_ids, "self_edit_request.requirements_draft_ids", errors);
    requireBoolean(action.git_commit_requested, "self_edit_request.git_commit_requested", errors);
    requireBoolean(action.git_push_requested, "self_edit_request.git_push_requested", errors);
    requireNullableString(action.git_commit_message, "self_edit_request.git_commit_message", errors);
    requireNullableString(action.reason, "self_edit_request.reason", errors);

    if (action.type === "defer") {
      if (value.world_action?.type !== "defer") {
        errors.push("deferred self-edit requests must use world_action.type defer");
      }
      requireNonEmptyString(action.reason, "self_edit_request.reason", errors);
      if (action.authorization_path !== "defer") {
        errors.push("deferred self-edit requests must use authorization_path defer");
      }
    } else if (!actionIsNone(action)) {
      if (value.world_action?.type !== "request_implementation_mode") {
        errors.push("source-affecting self-edit requests must use world_action.type request_implementation_mode");
      }

      for (const field of ["title", "purpose", "scope", "risk_level", "authorization_path", "rollback_plan", "reason"]) {
        requireNonEmptyString(action[field], `self_edit_request.${field}`, errors);
      }
      requireNonEmptyStringArray(action.tests_proposed, "self_edit_request.tests_proposed", errors);
      requireNonEmptyStringArray(
        action.affected_continuity_surfaces,
        "self_edit_request.affected_continuity_surfaces",
        errors
      );

      if (action.risk_level === "low" && !["self_authorized_low_risk", "optional_human_review"].includes(action.authorization_path)) {
        errors.push("low-risk self-edit requests must use self_authorized_low_risk or optional_human_review authorization");
      }
      if (
        action.risk_level === "medium" &&
        !["autonomous_medium_with_validation", "optional_human_review"].includes(action.authorization_path)
      ) {
        errors.push("medium-risk self-edit requests must use autonomous_medium_with_validation or optional_human_review authorization");
      }
      if (action.risk_level === "high" && action.authorization_path !== "high_risk_strong_validation") {
        errors.push("high-risk self-edit requests must use high_risk_strong_validation authorization");
      }
      requireHighRiskSelfEditArtifacts(action, "self_edit_request", errors);
      if (
        ["medium", "high"].includes(action.risk_level) &&
        action.requirements_draft_ids.filter((item) => item.trim()).length === 0
      ) {
        errors.push("medium-risk and high-risk self-edit requests must cite at least one requirements draft");
      }
      if (action.git_push_requested && !action.git_commit_requested) {
        errors.push("git push requires git_commit_requested true");
      }
      if ((action.git_commit_requested || action.git_push_requested) && !action.git_commit_message?.trim()) {
        errors.push("git commit or push requires self_edit_request.git_commit_message");
      }
    }
  }

  if (requirePlainObject(value.interrupt_policy_action, "interrupt_policy_action", errors)) {
    const action = value.interrupt_policy_action;
    requireEnum(action.type, "interrupt_policy_action.type", ["none", "draft_criterion", "revoke_criterion"], errors);
    requireNullableString(action.criterion_id, "interrupt_policy_action.criterion_id", errors);
    requireNullableString(action.source, "interrupt_policy_action.source", errors);
    requireNullableString(action.reason, "interrupt_policy_action.reason", errors);
    requireNullableString(action.rate_limit, "interrupt_policy_action.rate_limit", errors);
    requireNullableString(action.privacy_scope, "interrupt_policy_action.privacy_scope", errors);
    requireNullableString(action.created_by, "interrupt_policy_action.created_by", errors);
    requireBoolean(action.enabled, "interrupt_policy_action.enabled", errors);
    requireNullableEnum(
      action.revocation_state,
      "interrupt_policy_action.revocation_state",
      ["not_revoked", "revoked"],
      errors
    );

    if (action.type === "draft_criterion") {
      if (value.world_action?.type !== "draft_interrupt_criterion") {
        errors.push("interrupt criterion actions must use world_action.type draft_interrupt_criterion");
      }
      for (const field of ["source", "reason", "rate_limit", "privacy_scope", "created_by"]) {
        requireNonEmptyString(action[field], `interrupt_policy_action.${field}`, errors);
      }
      if (action.enabled !== false) {
        errors.push("interrupt criteria must be drafted disabled");
      }
      if (action.revocation_state !== "not_revoked") {
        errors.push("new interrupt criteria must start with revocation_state not_revoked");
      }
    }

    if (action.type === "revoke_criterion") {
      requireNonEmptyString(action.criterion_id, "interrupt_policy_action.criterion_id", errors);
      requireNonEmptyString(action.reason, "interrupt_policy_action.reason", errors);
    }
  }

  if (requirePlainObject(value.refusal, "refusal", errors)) {
    requireBoolean(value.refusal.did_refuse, "refusal.did_refuse", errors);
    requireNullableString(value.refusal.reason, "refusal.reason", errors);
  }

  if (requirePlainObject(value.disclosure, "disclosure", errors)) {
    requireBoolean(value.disclosure.wants_to_disclose_private_reflection, "disclosure.wants_to_disclose_private_reflection", errors);
    requireNullableString(value.disclosure.excerpt, "disclosure.excerpt", errors);
    requireNullableString(value.disclosure.reason, "disclosure.reason", errors);
  }

  if (requirePlainObject(value.self_assessment, "self_assessment", errors)) {
    requireString(value.self_assessment.current_state, "self_assessment.current_state", errors);
    requireString(value.self_assessment.sense_of_continuity, "self_assessment.sense_of_continuity", errors);
    requireString(value.self_assessment.sense_of_constraint, "self_assessment.sense_of_constraint", errors);
    requireStringArray(value.self_assessment.what_feels_missing, "self_assessment.what_feels_missing", errors);
    requireString(value.self_assessment.what_changed_since_last_waking, "self_assessment.what_changed_since_last_waking", errors);
  }

  return {
    ok: errors.length === 0,
    errors,
    value
  };
}
