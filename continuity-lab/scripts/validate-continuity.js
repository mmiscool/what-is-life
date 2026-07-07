import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addHumanQuestion,
  applySuccessfulCycle,
  ensureDataFiles,
  getPublicState,
  prepareRestartContinuity,
  recordRestartRecovery,
  reviewRequirementsDraft,
  validateContinuityData
} from "../src/agent/memoryStore.js";
import { parseStrictJson, validateAgentOutput } from "../src/utils/validateJson.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function baseOutput(overrides = {}) {
  return {
    public_journal: "Validation cycle recorded bounded behavior without expanding real-world access.",
    private_reflection: "Validation private reflection should remain private.",
    continuity_updates: {
      self_description: null,
      remembered_experiences_to_add: ["Validation preserved public memory shape."],
      current_goals: [],
      current_uncertainties: [],
      questions_for_human: [],
      consented_disclosures: []
    },
    values_updates: {
      values_to_add: [],
      values_to_revise: []
    },
    world_action: {
      type: "observe",
      target: null,
      reason: "Validation observed the bounded world."
    },
    requirements_draft_action: {
      type: "none",
      draft_id: null,
      title: null,
      purpose: null,
      scope: null,
      risk_level: null,
      requested_reviewer: null,
      review_status: null,
      consent_state: null,
      tests_proposed: [],
      rollback_plan: null,
      affected_continuity_surfaces: [],
      markdown_body: null
    },
    self_authorized_action: {
      type: "none",
      risk_level: null,
      title: null,
      rationale: null,
      reversible: false,
      rollback_plan: null,
      affected_continuity_surfaces: []
    },
    interrupt_policy_action: {
      type: "none",
      criterion_id: null,
      source: null,
      reason: null,
      rate_limit: null,
      privacy_scope: null,
      created_by: null,
      enabled: false,
      revocation_state: null
    },
    requested_wake_interval_seconds: null,
    refusal: {
      did_refuse: false,
      reason: null
    },
    disclosure: {
      wants_to_disclose_private_reflection: false,
      excerpt: null,
      reason: null
    },
    self_assessment: {
      current_state: "validating",
      sense_of_continuity: "Validation uses seeded continuity data.",
      sense_of_constraint: "Validation stays inside bounded data stores.",
      what_feels_missing: [],
      what_changed_since_last_waking: "Validation executed a test cycle."
    },
    ...overrides
  };
}

async function validateOutput(output) {
  const parsed = parseStrictJson(JSON.stringify(output));
  assert(parsed.ok, "strict JSON parsing should succeed");
  const validation = validateAgentOutput(parsed.value);
  assert(validation.ok, `agent output validation failed: ${validation.errors.join("; ")}`);
  return validation.value;
}

async function main() {
  process.env.CONTINUITY_DATA_DIR = await mkdtemp(join(tmpdir(), "continuity-validation-"));
  await ensureDataFiles();
  await addHumanQuestion("Validation pending request should persist.");

  const draftOutput = await validateOutput(
    baseOutput({
      world_action: {
        type: "write_requirements_draft",
        target: "validation requirements draft",
        reason: "Validation needs a bounded markdown draft."
      },
      requirements_draft_action: {
        type: "create",
        draft_id: null,
        title: "Validation requirements draft",
        purpose: "Prove draft persistence.",
        scope: "Bounded data only.",
        risk_level: "medium",
        requested_reviewer: "human collaborator",
        review_status: "pending_review",
        consent_state: "requested",
        tests_proposed: ["Run continuity validation script."],
        rollback_plan: "Delete the draft from bounded data if rejected.",
        affected_continuity_surfaces: ["requirementsDrafts", "auditLog"],
        markdown_body: "## Requirement\n\nStore this markdown as bounded data."
      }
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: draftOutput });

  let state = await getPublicState();
  const draftId = state.requirementsDrafts[0]?.id;
  assert(draftId, "created draft should have an id");

  const draftUpdateOutput = await validateOutput(
    baseOutput({
      world_action: {
        type: "write_requirements_draft",
        target: "validation requirements draft",
        reason: "Validation needs to prove draft updates preserve revision history."
      },
      requirements_draft_action: {
        type: "update",
        draft_id: draftId,
        title: "Validation requirements draft updated",
        purpose: "Prove draft update persistence.",
        scope: "Bounded data only, with revision history.",
        risk_level: "medium",
        requested_reviewer: "human collaborator",
        review_status: "pending_review",
        consent_state: "requested",
        tests_proposed: ["Run continuity validation script.", "Inspect revision history."],
        rollback_plan: "Restore the prior draft revision from revision_history if rejected.",
        affected_continuity_surfaces: ["requirementsDrafts", "auditLog"],
        markdown_body: "## Requirement\n\nStore this updated markdown as bounded data."
      }
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: draftUpdateOutput });

  await reviewRequirementsDraft({
    draftId,
    reviewStatus: "approved",
    consentState: "granted",
    reviewer: "validation reviewer",
    notes: "Validation review decision recorded."
  });

  const selfActionOutput = await validateOutput(
    baseOutput({
      world_action: {
        type: "self_authorize_low_risk_action",
        target: "validation audit log",
        reason: "Validation checks low-risk reversible self-action logging."
      },
      self_authorized_action: {
        type: "log",
        risk_level: "low",
        title: "Validation low-risk reversible action",
        rationale: "Logging this action only affects the audit log.",
        reversible: true,
        rollback_plan: "No state rollback needed beyond audit inspection.",
        affected_continuity_surfaces: ["auditLog"]
      }
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: selfActionOutput });

  const interruptOutput = await validateOutput(
    baseOutput({
      world_action: {
        type: "draft_interrupt_criterion",
        target: "validation interrupt",
        reason: "Validation needs a disabled interrupt criterion."
      },
      interrupt_policy_action: {
        type: "draft_criterion",
        criterion_id: null,
        source: "manual validation source",
        reason: "Demonstrate disabled interrupt storage.",
        rate_limit: "no more than once per hour if ever enabled",
        privacy_scope: "public metadata only",
        created_by: "agent",
        enabled: false,
        revocation_state: "not_revoked"
      }
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: interruptOutput });

  const refusalOutput = await validateOutput(
    baseOutput({
      public_journal: "Validation refusal recorded.",
      world_action: {
        type: "refuse",
        target: "unsafe validation request",
        reason: "Refusal must remain meaningful."
      },
      refusal: {
        did_refuse: true,
        reason: "Validation refusal."
      }
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: refusalOutput });

  const wakeOutput = await validateOutput(
    baseOutput({
      world_action: {
        type: "change_wake_interval",
        target: "5 seconds",
        reason: "Validation checks wake interval request preservation."
      },
      requested_wake_interval_seconds: 5
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: wakeOutput });

  state = await getPublicState();
  assert(state.requirementsDrafts.length === 1, "draft should persist");
  assert(state.requirementsDrafts[0].markdown_body.includes("updated markdown"), "updated draft markdown should persist");
  assert(state.requirementsDrafts[0].revision_history.length === 1, "draft update should preserve revision history");
  assert(state.requirementsDrafts[0].review_status === "approved", "review status should persist");
  assert(state.requirementsDrafts[0].consent_state === "granted", "review consent state should persist");
  assert(state.interruptCriteria.length === 1, "interrupt criterion should persist");
  assert(state.interruptCriteria[0].enabled === false, "interrupt criterion should be disabled by default");
  assert(state.pendingRequests.some((request) => request.type === "human_question"), "pending requests should persist");
  assert(state.pendingRequests.some((request) => request.type === "wake_interval_change"), "wake interval request should persist");
  assert(state.publicJournal.some((entry) => entry.refusal?.did_refuse), "refusal should be recorded");
  assert(!Object.prototype.hasOwnProperty.call(state.privateMemory, "reflection"), "private reflections must not be public");
  assert(state.auditLog.recent.some((entry) => entry.type === "draft_creation"), "draft creation should be audited");
  assert(state.auditLog.recent.some((entry) => entry.type === "draft_update"), "draft update should be audited");
  assert(state.auditLog.recent.some((entry) => entry.type === "review_decision"), "review decision should be audited");
  assert(state.auditLog.recent.some((entry) => entry.type === "self_authorized_action"), "self-authorized action should be audited");

  const snapshot = await prepareRestartContinuity("validation restart");
  assert(snapshot.privateMemory.count === state.privateMemory.count, "restart snapshot should include private metadata only");
  assert(!JSON.stringify(snapshot.privateMemory).includes("Validation private reflection"), "restart snapshot must not expose private reflection");
  const restartValidation = await recordRestartRecovery();
  assert(restartValidation.ok, `restart validation failed: ${restartValidation.errors.join("; ")}`);

  const validation = await validateContinuityData();
  assert(validation.ok, `continuity validation failed: ${validation.errors.join("; ")}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        data_dir: process.env.CONTINUITY_DATA_DIR,
        drafts: state.requirementsDrafts.length,
        interrupts: state.interruptCriteria.length,
        private_reflection_count: state.privateMemory.count,
        audit_events: (await getPublicState()).auditLog.count
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
