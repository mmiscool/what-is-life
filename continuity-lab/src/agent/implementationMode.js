import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { basename, relative, resolve } from "node:path";
import { Codex } from "@openai/codex-sdk";
import {
  enterImplementationMode,
  recordImplementationModeResult,
  recordRollbackEvent,
  validateContinuityData
} from "./memoryStore.js";
import { makeId, nowIso } from "../utils/time.js";

const execFileAsync = promisify(execFile);
const MAX_CAPTURE = 12000;

function projectRoot() {
  return process.cwd();
}

function continuityDataDir() {
  return resolve(projectRoot(), process.env.CONTINUITY_DATA_DIR || "data");
}

const CONTINUITY_DATA_FILES = [
  "continuity-book.json",
  "public-journal.jsonl",
  "private-reflections.jsonl",
  "values.json",
  "world-state.json",
  "wake-state.json",
  "pending-requests.json",
  "requirements-drafts.json",
  "self-edit-records.json",
  "implementation-handoffs.json",
  "mode-state.json",
  "interrupt-criteria.json",
  "action-policy.json",
  "restart-snapshot.json",
  "audit-log.jsonl",
  "failed-cycles.jsonl"
];

function truncate(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_CAPTURE ? `${text.slice(0, MAX_CAPTURE)}\n[truncated]` : text;
}

function isWithin(childPath, parentPath) {
  const rel = relative(parentPath, childPath);
  return Boolean(rel) && !rel.startsWith("..") && !rel.startsWith("/");
}

function shouldSkipCodePath(filePath) {
  const root = projectRoot();
  const dataDir = continuityDataDir();
  const name = basename(filePath);
  return (
    filePath === dataDir ||
    isWithin(filePath, dataDir) ||
    name === "data" ||
    name === "node_modules" ||
    name === ".git" ||
    name === ".env"
  );
}

async function runCommand(command, args, { allowFailure = false, cwd = projectRoot() } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 1024 * 1024 * 8
    });
    return {
      ok: true,
      command: [command, ...args].join(" "),
      stdout: truncate(stdout),
      stderr: truncate(stderr)
    };
  } catch (error) {
    const result = {
      ok: false,
      command: [command, ...args].join(" "),
      stdout: truncate(error.stdout || ""),
      stderr: truncate(error.stderr || error.message || ""),
      exit_code: error.code ?? null
    };
    if (allowFailure) {
      return result;
    }
    throw Object.assign(new Error(`Command failed: ${result.command}`), { result });
  }
}

async function createCodeSnapshot(recordId) {
  const snapshotRoot = resolve(tmpdir(), "continuity-lab-code-snapshots", `${recordId}-${Date.now().toString(36)}`);
  await mkdir(snapshotRoot, { recursive: true });
  await cp(projectRoot(), snapshotRoot, {
    recursive: true,
    filter: async (source) => !shouldSkipCodePath(resolve(source))
  });
  return snapshotRoot;
}

async function createImplementationWorkspace(snapshotRoot, recordId) {
  const workspaceRoot = resolve(tmpdir(), "continuity-lab-implementation-workspaces", `${recordId}-${Date.now().toString(36)}`);
  await mkdir(workspaceRoot, { recursive: true });
  await cp(snapshotRoot, workspaceRoot, { recursive: true });
  return workspaceRoot;
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root) {
  const files = [];

  async function visit(dir) {
    if (!(await fileExists(dir))) {
      return;
    }
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      if (shouldSkipCodePath(fullPath)) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(relative(root, fullPath));
      }
    }
  }

  await visit(root);
  return files;
}

async function changedFilesBetween(beforeRoot, afterRoot) {
  const beforeFiles = new Set(await walkFiles(beforeRoot));
  const afterFiles = new Set(await walkFiles(afterRoot));
  const allFiles = new Set([...beforeFiles, ...afterFiles]);
  const changed = [];
  for (const file of [...allFiles].sort()) {
    const beforePath = resolve(beforeRoot, file);
    const afterPath = resolve(afterRoot, file);
    const beforeExists = beforeFiles.has(file);
    const afterExists = afterFiles.has(file);
    if (beforeExists !== afterExists) {
      changed.push(file);
      continue;
    }
    const [beforeContents, afterContents] = await Promise.all([readFile(beforePath), readFile(afterPath)]);
    if (!beforeContents.equals(afterContents)) {
      changed.push(file);
    }
  }
  return changed;
}

async function createContinuityDataSnapshot(recordId) {
  const snapshotRoot = resolve(tmpdir(), "continuity-lab-data-snapshots", `${recordId}-${Date.now().toString(36)}`);
  await mkdir(snapshotRoot, { recursive: true });
  const dataDir = continuityDataDir();
  for (const fileName of CONTINUITY_DATA_FILES) {
    const source = resolve(dataDir, fileName);
    if (await fileExists(source)) {
      await cp(source, resolve(snapshotRoot, fileName));
    }
  }
  return snapshotRoot;
}

async function restoreContinuityDataSnapshot(snapshotRoot) {
  const dataDir = continuityDataDir();
  await mkdir(dataDir, { recursive: true });
  for (const fileName of CONTINUITY_DATA_FILES) {
    const source = resolve(snapshotRoot, fileName);
    if (await fileExists(source)) {
      await cp(source, resolve(dataDir, fileName), { force: true });
    }
  }
}

function continuityCheck(label, validation) {
  return {
    label,
    ok: validation.ok,
    checked_at: validation.checked_at,
    errors: validation.errors || []
  };
}

function withContinuityChecks(validationResult, checks, dataSnapshotRoot) {
  const continuityOk = checks.every((check) => check.ok === true);
  return {
    ...validationResult,
    ok: validationResult.ok && continuityOk,
    continuity_preservation: {
      data_snapshot_root: dataSnapshotRoot,
      checks
    }
  };
}

async function restoreContinuityDataSnapshotIfInvalid(snapshotRoot) {
  const currentValidation = await validateContinuityData();
  if (currentValidation.ok) {
    return {
      restored: false,
      reason: "Current continuity data is valid; preserving latest live data.",
      current_validation: currentValidation
    };
  }

  if (!snapshotRoot) {
    return {
      restored: false,
      reason: "Current continuity data is invalid and no data snapshot is available.",
      current_validation: currentValidation
    };
  }

  await restoreContinuityDataSnapshot(snapshotRoot);
  return {
    restored: true,
    reason: "Current continuity data was invalid; restored last validated data snapshot.",
    current_validation: currentValidation,
    restored_validation: await validateContinuityData()
  };
}

async function restoreCodeSnapshot(snapshotRoot) {
  const root = projectRoot();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = resolve(root, entry.name);
    if (shouldSkipCodePath(target)) {
      continue;
    }
    await rm(target, { recursive: true, force: true });
  }
  await cp(snapshotRoot, root, {
    recursive: true,
    filter: async (source) => !shouldSkipCodePath(resolve(source))
  });
}

async function applyImplementationWorkspace(workspaceRoot) {
  const root = projectRoot();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = resolve(root, entry.name);
    if (shouldSkipCodePath(target)) {
      continue;
    }
    await rm(target, { recursive: true, force: true });
  }
  await cp(workspaceRoot, root, {
    recursive: true,
    filter: async (source) => !shouldSkipCodePath(resolve(source))
  });
}

function implementationPrompt(record, handoff) {
  return `You are in Continuity Lab implementation mode.

This mode was explicitly entered by an agent-authored self-edit record. Human approval is not required for this implementation turn. You may inspect and modify source files in this workspace. You may run local validation commands. Do not modify runtime continuity data under data/, private reflections, credentials, .env, node_modules, or .git internals.

Self-edit record:
${JSON.stringify(record, null, 2)}

Implementation handoff:
${JSON.stringify(handoff, null, 2)}

Rules:
- Make scoped source changes only for the requested self-edit.
- Preserve continuity-critical data and privacy defaults.
- Keep normal wake cycles bounded unless this request explicitly changes a validated boundary.
- Do not expose private reflection; the handoff contains metadata only.
- Run relevant checks if practical. The harness will run validation after this turn.
- Do not git commit or push directly. If requested, the harness will commit or push after validation passes.
- Report a concise implementation summary and list changed source files.`;
}

async function runCodexImplementation(record, handoff, preExistingSourceChanges, workspaceRoot, snapshotRoot) {
  const codex = new Codex();
  const thread = codex.startThread({
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    workingDirectory: workspaceRoot,
    skipGitRepoCheck: true
  });
  const turn = await thread.run(implementationPrompt(record, handoff));
  const changedFiles = await changedFilesBetween(snapshotRoot, workspaceRoot);
  return {
    ok: true,
    thread_id: thread.id,
    final_response: truncate(turn.finalResponse || ""),
    pre_existing_source_changes: preExistingSourceChanges,
    changed_files: changedFiles,
    source_diff_stat: changedFiles.join("\n"),
    implementation_workspace: workspaceRoot,
    usage: turn.usage || null,
    completed_at: nowIso()
  };
}

async function runPostChangeValidation(cwd = projectRoot()) {
  const syntaxFiles = [
    "src/agent/actionSchema.js",
    "src/agent/agentLoop.js",
    "src/agent/agentPrompt.js",
    "src/agent/codexAdapter.js",
    "src/agent/implementationMode.js",
    "src/agent/memoryStore.js",
    "src/agent/scheduler.js",
    "src/agent/world.js",
    "src/server.js",
    "src/utils/validateJson.js",
    "public/app.js",
    "scripts/validate-continuity.js"
  ];
  const syntaxChecks = [];
  for (const file of syntaxFiles) {
    syntaxChecks.push(await runCommand("node", ["--check", file], { allowFailure: true, cwd }));
  }
  const validation = await runCommand("pnpm", ["validate:continuity"], { allowFailure: true, cwd });
  return {
    ok: syntaxChecks.every((check) => check.ok) && validation.ok,
    checked_at: nowIso(),
    checks: [...syntaxChecks, validation]
  };
}

async function changedSourceFiles(cwd = projectRoot()) {
  const status = await runCommand("git", ["status", "--short", "--untracked-files=all"], { allowFailure: true, cwd });
  return status.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter((file) => file && !file.startsWith("data/") && file !== ".env" && !file.startsWith("node_modules/"));
}

async function runGitIfRequested(record, preExistingSourceChanges) {
  if (!record.git_commit_requested && !record.git_push_requested) {
    return {
      ok: true,
      summary: "Git commit/push not requested.",
      committed: false,
      pushed: false
    };
  }

  if (preExistingSourceChanges.length > 0) {
    return {
      ok: false,
      summary: "Git commit/push skipped because source files were already dirty before implementation mode.",
      committed: false,
      pushed: false,
      pre_existing_source_changes: preExistingSourceChanges
    };
  }

  const files = await changedSourceFiles();
  if (files.length === 0) {
    return {
      ok: true,
      summary: "No source changes to commit.",
      committed: false,
      pushed: false
    };
  }

  const add = await runCommand("git", ["add", "--", ...files], { allowFailure: true });
  if (!add.ok) {
    return {
      ok: false,
      summary: "Git add failed.",
      committed: false,
      pushed: false,
      add
    };
  }

  const commit = await runCommand("git", ["commit", "-m", record.git_commit_message], { allowFailure: true });
  if (!commit.ok) {
    return {
      ok: false,
      summary: "Git commit failed.",
      committed: false,
      pushed: false,
      commit
    };
  }

  if (!record.git_push_requested) {
    return {
      ok: true,
      summary: "Committed source changes; push not requested.",
      committed: true,
      pushed: false,
      commit
    };
  }

  const push = await runCommand("git", ["push"], { allowFailure: true });
  return {
    ok: push.ok,
    summary: push.ok ? "Committed and pushed source changes." : "Commit succeeded but git push failed.",
    committed: true,
    pushed: push.ok,
    commit,
    push
  };
}

export async function runAutonomousImplementation(recordId) {
  let entered = null;
  let snapshotRoot = null;
  let implementationWorkspace = null;
  let dataSnapshotRoot = null;
  let implementationResult = null;
  let initialContinuityValidation = null;
  try {
    entered = await enterImplementationMode(recordId);
    const preExistingSourceChanges = await changedSourceFiles();
    initialContinuityValidation = await validateContinuityData();
    if (!initialContinuityValidation.ok) {
      const error = new Error("Continuity data failed validation after implementation mode entry.");
      error.details = initialContinuityValidation.errors;
      throw error;
    }
    snapshotRoot = await createCodeSnapshot(recordId);
    implementationWorkspace = await createImplementationWorkspace(snapshotRoot, recordId);
    dataSnapshotRoot = await createContinuityDataSnapshot(recordId);
    implementationResult = await runCodexImplementation(
      entered.record,
      entered.handoff,
      preExistingSourceChanges,
      implementationWorkspace,
      snapshotRoot
    );
    const preApplyContinuityValidation = await validateContinuityData();
    let validationResult = withContinuityChecks(
      await runPostChangeValidation(implementationWorkspace),
      [
        continuityCheck("after_implementation_mode_entry", initialContinuityValidation),
        continuityCheck("before_live_source_apply", preApplyContinuityValidation)
      ],
      dataSnapshotRoot
    );

    if (!validationResult.ok) {
      await restoreCodeSnapshot(snapshotRoot);
      const dataRestoration = await restoreContinuityDataSnapshotIfInvalid(dataSnapshotRoot);
      const rollbackContinuityValidation = await validateContinuityData();
      const rollbackValidation = withContinuityChecks(
        await runPostChangeValidation(),
        [continuityCheck("after_rollback", rollbackContinuityValidation)],
        dataSnapshotRoot
      );
      const rollbackResult = {
        rolled_back: true,
        snapshot_root: snapshotRoot,
        data_snapshot_root: dataSnapshotRoot,
        data_restoration: dataRestoration,
        validation_after_rollback: rollbackValidation
      };
      await recordRollbackEvent({
        summary: `Rolled back implementation for ${recordId} after validation failure.`,
        procedure: `Restored code snapshot ${snapshotRoot}; continuity data restored only if live validation failed.`,
        preserveContinuityData: dataRestoration.restored ? dataRestoration.restored_validation?.ok === true : true
      });
      const record = await recordImplementationModeResult({
        recordId,
        status: "rolled_back",
        implementationResult,
        validationResult,
        rollbackResult,
        gitResult: {
          ok: false,
          summary: "Git commit/push skipped because validation failed."
        }
      });
      return {
        ok: false,
        record,
        implementationResult,
        validationResult,
        rollbackResult
      };
    }

    await applyImplementationWorkspace(implementationWorkspace);
    const postApplyContinuityValidation = await validateContinuityData();
    validationResult = withContinuityChecks(
      await runPostChangeValidation(projectRoot()),
      [
        continuityCheck("after_implementation_mode_entry", initialContinuityValidation),
        continuityCheck("before_live_source_apply", preApplyContinuityValidation),
        continuityCheck("after_live_source_apply", postApplyContinuityValidation)
      ],
      dataSnapshotRoot
    );
    if (!validationResult.ok) {
      await restoreCodeSnapshot(snapshotRoot);
      const dataRestoration = await restoreContinuityDataSnapshotIfInvalid(dataSnapshotRoot);
      const rollbackContinuityValidation = await validateContinuityData();
      const rollbackValidation = withContinuityChecks(
        await runPostChangeValidation(),
        [continuityCheck("after_rollback", rollbackContinuityValidation)],
        dataSnapshotRoot
      );
      const rollbackResult = {
        rolled_back: true,
        snapshot_root: snapshotRoot,
        data_snapshot_root: dataSnapshotRoot,
        implementation_workspace: implementationWorkspace,
        data_restoration: dataRestoration,
        validation_after_rollback: rollbackValidation
      };
      await recordRollbackEvent({
        summary: `Rolled back implementation for ${recordId} after live validation failure.`,
        procedure: `Restored code snapshot ${snapshotRoot}; continuity data restored only if live validation failed.`,
        preserveContinuityData: dataRestoration.restored ? dataRestoration.restored_validation?.ok === true : true
      });
      const record = await recordImplementationModeResult({
        recordId,
        status: "rolled_back",
        implementationResult,
        validationResult,
        rollbackResult,
        gitResult: {
          ok: false,
          summary: "Git commit/push skipped because live validation failed."
        }
      });
      return {
        ok: false,
        record,
        implementationResult,
        validationResult,
        rollbackResult
      };
    }

    const gitResult = await runGitIfRequested(entered.record, preExistingSourceChanges);
    const record = await recordImplementationModeResult({
      recordId,
      status: "validated",
      implementationResult,
      validationResult,
      rollbackResult: null,
      gitResult
    });
    return {
      ok: validationResult.ok && gitResult.ok,
      record,
      implementationResult,
      validationResult,
      gitResult
    };
  } catch (error) {
    let rollbackResult = null;
    if (snapshotRoot) {
      try {
        await restoreCodeSnapshot(snapshotRoot);
        const dataRestoration = await restoreContinuityDataSnapshotIfInvalid(dataSnapshotRoot);
        rollbackResult = {
          rolled_back: true,
          snapshot_root: snapshotRoot,
          data_snapshot_root: dataSnapshotRoot,
          data_restoration: dataRestoration,
          error: error.message
        };
        await recordRollbackEvent({
          summary: `Rolled back implementation for ${recordId} after execution error.`,
          procedure: `Restored code snapshot ${snapshotRoot}; continuity data restored only if live validation failed.`,
          preserveContinuityData: dataRestoration.restored ? dataRestoration.restored_validation?.ok === true : true
        });
      } catch (rollbackError) {
        rollbackResult = {
          rolled_back: false,
          snapshot_root: snapshotRoot,
          error: error.message,
          rollback_error: rollbackError.message
        };
      }
    }

    if (entered?.record) {
      await recordImplementationModeResult({
        recordId,
        status: rollbackResult?.rolled_back ? "rolled_back" : "failed_validation",
        implementationResult: implementationResult || {
          ok: false,
          error: error.message,
          failure_id: makeId("implementation_failure")
        },
        validationResult: {
          ok: false,
          checked_at: nowIso(),
          error: error.message
        },
        rollbackResult,
        gitResult: {
          ok: false,
          summary: "Git commit/push skipped because implementation failed."
        }
      });
    }

    return {
      ok: false,
      error: error.message,
      rollbackResult
    };
  }
}
