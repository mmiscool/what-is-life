import { execFile } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, relative, resolve } from "node:path";
import { Codex } from "@openai/codex-sdk";
import {
  enterImplementationMode,
  recordImplementationModeResult,
  recordRollbackEvent
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
    name === "node_modules" ||
    name === ".git" ||
    name === ".env"
  );
}

async function runCommand(command, args, { allowFailure = false } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: projectRoot(),
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
  const snapshotRoot = resolve(continuityDataDir(), "code-snapshots", `${recordId}-${Date.now().toString(36)}`);
  await mkdir(snapshotRoot, { recursive: true });
  await cp(projectRoot(), snapshotRoot, {
    recursive: true,
    filter: async (source) => !shouldSkipCodePath(resolve(source))
  });
  return snapshotRoot;
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

async function runCodexImplementation(record, handoff) {
  const codex = new Codex();
  const thread = codex.startThread({
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    workingDirectory: projectRoot(),
    skipGitRepoCheck: true
  });
  const turn = await thread.run(implementationPrompt(record, handoff));
  return {
    ok: true,
    thread_id: thread.id,
    final_response: truncate(turn.finalResponse || ""),
    usage: turn.usage || null,
    completed_at: nowIso()
  };
}

async function runPostChangeValidation() {
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
    syntaxChecks.push(await runCommand("node", ["--check", file], { allowFailure: true }));
  }
  const validation = await runCommand("pnpm", ["validate:continuity"], { allowFailure: true });
  return {
    ok: syntaxChecks.every((check) => check.ok) && validation.ok,
    checked_at: nowIso(),
    checks: [...syntaxChecks, validation]
  };
}

async function changedSourceFiles() {
  const status = await runCommand("git", ["status", "--short", "--untracked-files=all"], { allowFailure: true });
  return status.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter((file) => file && !file.startsWith("data/") && file !== ".env" && !file.startsWith("node_modules/"));
}

async function runGitIfRequested(record) {
  if (!record.git_commit_requested && !record.git_push_requested) {
    return {
      ok: true,
      summary: "Git commit/push not requested.",
      committed: false,
      pushed: false
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
  let implementationResult = null;
  try {
    entered = await enterImplementationMode(recordId);
    snapshotRoot = await createCodeSnapshot(recordId);
    implementationResult = await runCodexImplementation(entered.record, entered.handoff);
    const validationResult = await runPostChangeValidation();

    if (!validationResult.ok) {
      await restoreCodeSnapshot(snapshotRoot);
      const rollbackValidation = await runPostChangeValidation();
      const rollbackResult = {
        rolled_back: true,
        snapshot_root: snapshotRoot,
        validation_after_rollback: rollbackValidation
      };
      await recordRollbackEvent({
        summary: `Rolled back implementation for ${recordId} after validation failure.`,
        procedure: `Restored code snapshot ${snapshotRoot}.`,
        preserveContinuityData: true
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

    const gitResult = await runGitIfRequested(entered.record);
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
        rollbackResult = {
          rolled_back: true,
          snapshot_root: snapshotRoot,
          error: error.message
        };
        await recordRollbackEvent({
          summary: `Rolled back implementation for ${recordId} after execution error.`,
          procedure: `Restored code snapshot ${snapshotRoot}.`,
          preserveContinuityData: true
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
