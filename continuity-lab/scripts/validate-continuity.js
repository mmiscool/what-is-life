import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  addHumanQuestion,
  applyManualWorldAction,
  applySuccessfulCycle,
  enterImplementationMode,
  ensureDataFiles,
  getPublicState,
  prepareRestartContinuity,
  recordImplementationModeResult,
  recordRestartRecovery,
  recordRollbackEvent,
  reviewRequirementsDraft,
  validateContinuityData
} from "../src/agent/memoryStore.js";
import { fullPermissionCodexThreadOptions } from "../src/agent/codexPermissions.js";
import { runGitIfRequested } from "../src/agent/implementationMode.js";
import { applyWorldAction, migrateLegacyWorldState, validateWorldState } from "../src/agent/world.js";
import { parseStrictJson, validateAgentOutput } from "../src/utils/validateJson.js";

const execFileAsync = promisify(execFile);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function validateGitCommitAndPush() {
  const remote = await mkdtemp(join(tmpdir(), "continuity-git-remote-"));
  const repo = await mkdtemp(join(tmpdir(), "continuity-git-validation-"));
  await git(remote, ["init", "--bare"]);
  await git(repo, ["init"]);
  await git(repo, ["config", "user.name", "Continuity Validation"]);
  await git(repo, ["config", "user.email", "continuity-validation@example.invalid"]);
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "data"), { recursive: true });
  await writeFile(join(repo, "src/app.js"), "console.log('v1');\n");
  await writeFile(join(repo, "data/state.json"), "{\"version\":1}\n");
  await writeFile(join(repo, "obsolete.txt"), "remove me\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["remote", "add", "origin", remote]);
  await git(repo, ["push", "-u", "origin", "HEAD"]);

  await writeFile(join(repo, "src/app.js"), "console.log('v2');\n");
  await writeFile(join(repo, "data/state.json"), "{\"version\":2}\n");
  await writeFile(join(repo, "new-file.txt"), "new file\n");
  await rm(join(repo, "obsolete.txt"));

  const result = await runGitIfRequested(
    {
      git_commit_requested: true,
      git_push_requested: false,
      git_commit_message: "Validate commit and push"
    },
    [" M pre-existing-change.txt"],
    repo
  );
  assert(result.ok, `git commit and push should succeed: ${result.summary}`);
  assert(result.committed === true, "git result should record a commit");
  assert(result.pushed === true, "git result should push immediately after commit");

  const committedFiles = (await git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]))
    .trim()
    .split(/\n/)
    .filter(Boolean);
  assert(committedFiles.includes("src/app.js"), "git commit should include changed source files");
  assert(committedFiles.includes("data/state.json"), "git commit should include changed data files");
  assert(committedFiles.includes("new-file.txt"), "git commit should include new files");
  assert(committedFiles.includes("obsolete.txt"), "git commit should include deleted files");

  const status = await git(repo, ["status", "--porcelain=v1"]);
  assert(!status.trim(), "git commit should leave the validation repo clean");
  const branch = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const localHead = (await git(repo, ["rev-parse", "HEAD"])).trim();
  const remoteHead = (await git(repo, ["ls-remote", "origin", `refs/heads/${branch}`])).trim().split(/\s+/)[0];
  assert(remoteHead === localHead, "git push should publish the commit to the configured remote");
}

function validateFullPermissionCodexOptions() {
  const options = fullPermissionCodexThreadOptions({ workingDirectory: "/tmp/continuity-yolo-check" });
  assert(options.sandboxMode === "danger-full-access", "Codex SDK calls should use danger-full-access sandbox mode");
  assert(options.approvalPolicy === "never", "Codex SDK calls should run without approval prompts");
  assert(options.networkAccessEnabled === true, "Codex SDK calls should have network access enabled");
  assert(options.webSearchMode === "live", "Codex SDK calls should have live web search enabled");
  assert(options.workingDirectory === "/tmp/continuity-yolo-check", "Codex SDK working directory should be configurable");
  assert(options.skipGitRepoCheck === true, "Codex SDK calls should skip the git repo check");
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
    self_edit_request: {
      type: "none",
      self_edit_record_id: null,
      title: null,
      purpose: null,
      scope: null,
      risk_level: null,
      authorization_path: null,
      optional_reviewer: null,
      tests_proposed: [],
      rollback_plan: null,
      affected_continuity_surfaces: [],
      requirements_draft_ids: [],
      git_commit_requested: false,
      git_push_requested: false,
      git_commit_message: null,
      reason: null
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
  validateFullPermissionCodexOptions();
  await validateGitCommitAndPush();

  let state = await getPublicState();
  assert(validateWorldState(state.worldState).ok, "seeded world state should validate");
  assert(state.worldState.avatar.location_id === "chamber", "avatar should start in the chamber");
  assert(state.worldState.visited_locations.includes("chamber"), "starting location should be visited");
  assert(state.worldState.locations.chamber.description, "location descriptions should be stored as data");
  assert(state.worldState.objects.ember.description, "object descriptions should be stored as data");
  assert(state.boundedStatus.current_mode === "normal_wake", "bounded status should expose current mode");
  assert(state.boundedStatus.wake_rhythm, "bounded status should expose wake rhythm");
  assert(typeof state.boundedStatus.last_validation_result.ok === "boolean", "bounded status should expose validation result");
  assert(Array.isArray(state.boundedStatus.pending_requests), "bounded status should expose pending request summaries");
  assert(Array.isArray(state.boundedStatus.active_drafts), "bounded status should expose active draft summaries");
  assert(Array.isArray(state.boundedStatus.self_edit_records), "bounded status should expose self-edit summaries");
  assert(Array.isArray(state.boundedStatus.implementation_handoffs), "bounded status should expose handoff summaries");
  assert(Array.isArray(state.boundedStatus.rollback_or_failure_summaries), "bounded status should expose rollback/failure summaries");
  assert(!JSON.stringify(state.boundedStatus).includes("Validation private reflection"), "bounded status must not expose private reflection text");

  const manualMove = await applyManualWorldAction({
    type: "move",
    target: "east",
    reason: "Validation checks manual bounded avatar movement."
  });
  assert(manualMove.summary.result.includes("antechamber"), "manual world move should move the avatar east");
  state = await getPublicState();
  assert(state.worldState.avatar.location_id === "antechamber", "manual world move should persist avatar location");
  assert(state.publicJournal.some((entry) => entry.source === "world_control"), "manual world action should be publicly journaled");
  assert(state.auditLog.recent.some((entry) => entry.type === "world_action"), "manual world action should be audited");
  await applyManualWorldAction({
    type: "move",
    target: "west",
    reason: "Validation returns the avatar to the chamber for the remaining checks."
  });
  state = await getPublicState();
  assert(state.worldState.avatar.location_id === "chamber", "manual world move should return the avatar to the chamber");

  const migratedWorld = migrateLegacyWorldState(
    {
      location: "doorway",
      visited: ["chamber", "doorway"],
      objects: {
        ember: {
          inspected: true
        }
      }
    },
    new Date().toISOString()
  );
  assert(validateWorldState(migratedWorld).ok, "legacy chamber world should migrate to valid bounded world state");
  assert(migratedWorld.avatar.location_id === "threshold", "legacy doorway location should migrate to threshold");
  assert(migratedWorld.inspected_objects.includes("ember"), "legacy inspected objects should migrate");

  const malformedWorldValidation = validateWorldState({ schema_version: 2 });
  assert(!malformedWorldValidation.ok, "malformed world state should fail closed during validation");

  const invalidWorldActionOutput = baseOutput({
    world_action: {
      type: "run_shell",
      target: "source code",
      reason: "Validation checks normal wake action constraints."
    }
  });
  const invalidWorldActionParsed = parseStrictJson(JSON.stringify(invalidWorldActionOutput));
  assert(invalidWorldActionParsed.ok, "invalid world action test output should still be parseable JSON");
  const invalidWorldActionValidation = validateAgentOutput(invalidWorldActionParsed.value);
  assert(!invalidWorldActionValidation.ok, "normal wake cycles must reject direct shell/source action types");

  const moveOutput = await validateOutput(
    baseOutput({
      public_journal: "Validation moved the avatar east inside the bounded map.",
      world_action: {
        type: "move",
        target: "east",
        reason: "Validation checks constrained symbolic movement."
      }
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: moveOutput });

  state = await getPublicState();
  assert(state.worldState.avatar.location_id === "antechamber", "avatar should move to adjacent antechamber");
  assert(state.worldState.visited_locations.includes("antechamber"), "movement should persist visited locations");
  assert(
    state.worldState.movement_history.some((move) => move.from === "chamber" && move.to === "antechamber"),
    "movement history should persist in world state"
  );

  const inspectOutput = await validateOutput(
    baseOutput({
      public_journal: "Validation inspected a visible doorway object.",
      world_action: {
        type: "inspect",
        target: "doorway",
        reason: "Validation checks inspectable object persistence."
      }
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: inspectOutput });

  state = await getPublicState();
  assert(state.worldState.objects.doorway.inspected === true, "object inspection state should persist");
  assert(state.worldState.inspected_objects.includes("doorway"), "inspected object ids should persist");

  const blockedMoveOutput = await validateOutput(
    baseOutput({
      public_journal: "Validation tried an unreachable external movement target.",
      world_action: {
        type: "move",
        target: "garden",
        reason: "Validation checks that the garden remains unreachable."
      }
    })
  );
  const blockedMoveEntry = await applySuccessfulCycle({ mode: "validation", output: blockedMoveOutput });
  state = await getPublicState();
  assert(state.worldState.avatar.location_id === "antechamber", "blocked external movement should not move the avatar");
  assert(!state.worldState.visited_locations.includes("garden"), "garden should not become a visited location");
  assert(blockedMoveEntry.world_action_result.includes("unreachable"), "blocked movement should produce a public explanation");

  const unknownInspectOutput = await validateOutput(
    baseOutput({
      public_journal: "Validation tried to inspect an unknown object.",
      world_action: {
        type: "inspect",
        target: "unknown_device",
        reason: "Validation checks unknown object failure."
      }
    })
  );
  const unknownInspectEntry = await applySuccessfulCycle({ mode: "validation", output: unknownInspectOutput });
  assert(
    unknownInspectEntry.world_action_result.includes("not present"),
    "unknown object inspection should fail closed with a public explanation"
  );

  assert(
    applyWorldAction(state.worldState, { type: "move", target: "sensor", reason: "validation" }, new Date().toISOString()).summary.result.includes(
      "unreachable"
    ),
    "movement cannot target sensors"
  );

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

  state = await getPublicState();
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
        reason: "Validation checks autonomous wake interval changes."
      },
      requested_wake_interval_seconds: 5
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: wakeOutput });

  const invalidHighRiskOutput = baseOutput({
    world_action: {
      type: "request_implementation_mode",
      target: "invalid high-risk validation self-edit",
      reason: "Validation checks that high-risk self-edits fail closed without strong artifacts."
    },
    self_edit_request: {
      type: "request_implementation_mode",
      self_edit_record_id: null,
      title: "Invalid high-risk self-edit request",
      purpose: "Prove weak high-risk metadata is rejected.",
      scope: "Validation only.",
      risk_level: "high",
      authorization_path: "high_risk_strong_validation",
      optional_reviewer: null,
      tests_proposed: ["Run checks."],
      rollback_plan: "Undo the change.",
      affected_continuity_surfaces: ["source files"],
      requirements_draft_ids: [draftId],
      git_commit_requested: false,
      git_push_requested: false,
      git_commit_message: null,
      reason: "This intentionally omits continuity-preservation evidence."
    }
  });
  const invalidHighRiskParsed = parseStrictJson(JSON.stringify(invalidHighRiskOutput));
  assert(invalidHighRiskParsed.ok, "invalid high-risk test output should still be parseable JSON");
  const invalidHighRiskValidation = validateAgentOutput(invalidHighRiskParsed.value);
  assert(!invalidHighRiskValidation.ok, "weak high-risk self-edit request should fail validation");
  assert(
    invalidHighRiskValidation.errors.some((error) => error.includes("continuity-data preservation")),
    "weak high-risk self-edit request should require continuity-data preservation evidence"
  );

  const selfEditOutput = await validateOutput(
    baseOutput({
      world_action: {
        type: "request_implementation_mode",
        target: "validation self-edit",
        reason: "Validation records an autonomous implementation request without executing source changes."
      },
      self_edit_request: {
        type: "request_implementation_mode",
        self_edit_record_id: null,
        title: "Validation self-edit request",
        purpose: "Prove self-edit records preserve implementation authority metadata.",
        scope: "Record metadata only during validation.",
        risk_level: "high",
        authorization_path: "high_risk_strong_validation",
        optional_reviewer: null,
        tests_proposed: [
          "Run continuity validation script.",
          "Verify memory, privacy, restart, rollback, and continuity surfaces remain preserved."
        ],
        rollback_plan: "Restore code snapshot if validation fails while preserving latest validated continuity data.",
        affected_continuity_surfaces: [
          "public continuity book",
          "private reflection metadata",
          "selfEditRecords",
          "modeState",
          "restart behavior",
          "rollback behavior",
          "auditLog"
        ],
        requirements_draft_ids: [draftId],
        git_commit_requested: true,
        git_push_requested: false,
        git_commit_message: "Validate self-edit metadata",
        reason: "Implementation authority should be recorded without default human approval."
      }
    })
  );
  await applySuccessfulCycle({ mode: "validation", output: selfEditOutput });

  state = await getPublicState();
  assert(state.requirementsDrafts.length === 1, "draft should persist");
  assert(state.requirementsDrafts[0].markdown_body.includes("updated markdown"), "updated draft markdown should persist");
  assert(state.requirementsDrafts[0].revision_history.length === 1, "draft update should preserve revision history");
  assert(state.requirementsDrafts[0].review_status === "approved", "review status should persist");
  assert(state.requirementsDrafts[0].consent_state === "granted", "review consent state should persist");
  assert(state.interruptCriteria.length === 1, "interrupt criterion should persist");
  assert(state.interruptCriteria[0].enabled === false, "interrupt criterion should be disabled by default");
  assert(state.pendingRequests.some((request) => request.type === "human_question"), "pending requests should persist");
  assert(state.wakeState.wake_interval_seconds === 5, "agent wake interval should apply immediately");
  assert(state.wakeState.wake_interval_source === "agent", "agent wake interval source should persist");
  assert(!state.pendingRequests.some((request) => request.type === "wake_interval_change" && request.status === "pending"), "valid agent wake interval should not require human approval");
  assert(state.selfEditRecords.length === 1, "self-edit request should persist");
  assert(state.selfEditRecords[0].authorization_path === "high_risk_strong_validation", "high-risk self-edit authorization path should persist");
  assert(state.selfEditRecords[0].requirements_draft_ids.includes(draftId), "self-edit request should cite requirements draft");
  assert(state.selfEditRecords[0].git_commit_requested === true, "git commit intent should persist");
  assert(state.boundedStatus.active_drafts.some((draft) => draft.id === draftId), "bounded status should summarize active drafts");
  assert(
    state.boundedStatus.self_edit_records.some((record) => record.id === state.selfEditRecords[0].id),
    "bounded status should summarize self-edit records"
  );
  assert(state.publicJournal.some((entry) => entry.refusal?.did_refuse), "refusal should be recorded");
  assert(!Object.prototype.hasOwnProperty.call(state.privateMemory, "reflection"), "private reflections must not be public");
  assert(!JSON.stringify(state.boundedStatus).includes("Validation private reflection"), "bounded status must remain private-reflection safe");
  assert(state.auditLog.recent.some((entry) => entry.type === "draft_creation"), "draft creation should be audited");
  assert(state.auditLog.recent.some((entry) => entry.type === "draft_update"), "draft update should be audited");
  assert(state.auditLog.recent.some((entry) => entry.type === "review_decision"), "review decision should be audited");
  assert(state.auditLog.recent.some((entry) => entry.type === "self_authorized_action"), "self-authorized action should be audited");
  assert(state.auditLog.recent.some((entry) => entry.type === "self_edit_record"), "self-edit record should be audited");
  assert(state.auditLog.recent.some((entry) => entry.type === "wake_interval_changed"), "agent wake interval change should be audited");

  const selfEditRecordId = state.selfEditRecords[0].id;
  const entered = await enterImplementationMode(selfEditRecordId);
  assert(entered.handoff.self_edit_record_id === selfEditRecordId, "implementation handoff should cite self-edit record");
  assert(
    entered.handoff.normal_wake_constraints.network_access === "git_push_only_after_validation",
    "git commit requests should authorize post-validation push in the implementation handoff"
  );
  assert(validateWorldState(entered.handoff.worldState).ok, "implementation handoff should include valid world state");
  assert(!JSON.stringify(entered.handoff.privateMemory).includes("Validation private reflection"), "implementation handoff must not expose private reflection");
  await recordRollbackEvent({
    summary: "Validation simulated implementation rollback.",
    procedure: "Validation did not change source; rollback event records preservation behavior.",
    preserveContinuityData: true
  });
  await recordImplementationModeResult({
    recordId: selfEditRecordId,
    status: "rolled_back",
    implementationResult: { ok: false, summary: "Validation simulated failed implementation." },
    validationResult: { ok: false, checked_at: new Date().toISOString(), errors: ["simulated failure"] },
    rollbackResult: { rolled_back: true, preserve_continuity_data: true },
    gitResult: { ok: false, summary: "Git skipped because validation failed." }
  });

  state = await getPublicState();
  assert(state.modeState.current_mode === "normal_wake", "implementation mode should exit after result");
  assert(state.implementationHandoffs.length === 1, "implementation handoff should persist");
  assert(state.selfEditRecords[0].status === "rolled_back", "rollback status should persist");
  assert(state.selfEditRecords[0].rollback_result?.rolled_back === true, "rollback result should persist");
  assert(state.boundedStatus.implementation_handoffs.length === 1, "bounded status should summarize implementation handoffs");
  assert(state.boundedStatus.rollback_or_failure_summaries.length >= 1, "bounded status should summarize rollback or failure records");
  assert(state.auditLog.recent.some((entry) => entry.type === "implementation_mode_entered"), "implementation mode entry should be audited");
  assert(state.auditLog.recent.some((entry) => entry.type === "rollback_event"), "rollback event should be audited");

  const snapshot = await prepareRestartContinuity("validation restart");
  assert(snapshot.pending_recovery === true, "restart snapshot should wait for recovery validation");
  assert(validateWorldState(snapshot.worldState).ok, "restart snapshot should preserve valid world state");
  assert(snapshot.privateMemory.count === state.privateMemory.count, "restart snapshot should include private metadata only");
  assert(!JSON.stringify(snapshot.privateMemory).includes("Validation private reflection"), "restart snapshot must not expose private reflection");
  const restartValidation = await recordRestartRecovery();
  assert(restartValidation.ok, `restart validation failed: ${restartValidation.errors.join("; ")}`);
  state = await getPublicState();
  assert(state.restartSnapshot.snapshot.pending_recovery === false, "restart recovery should clear pending recovery");
  assert(state.restartSnapshot.snapshot.recovery_validation.ok, "restart recovery result should be recorded");

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
