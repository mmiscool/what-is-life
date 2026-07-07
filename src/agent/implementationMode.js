import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { basename, relative, resolve } from "node:path";
import { Codex } from "@openai/codex-sdk";
import { fullPermissionCodexThreadOptions } from "./codexPermissions.js";
import {
  createPublicationPrivacyReview,
  extractPorcelainPaths,
  splitGitOutputLines,
  summarizePublicationPrivacyReview
} from "./publicationSafety.js";
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
- Do not git commit or push directly. If requested, the harness will commit all repository changes and push after validation passes.
- Report a concise implementation summary and list changed source files.`;
}

async function runCodexImplementation(record, handoff, preExistingRepoChanges, snapshotRoot) {
  const workingRoot = projectRoot();
  const codex = new Codex();
  const thread = codex.startThread(fullPermissionCodexThreadOptions({ workingDirectory: workingRoot }));
  const turn = await thread.run(implementationPrompt(record, handoff));
  const changedFiles = await changedFilesBetween(snapshotRoot, workingRoot);
  return {
    ok: true,
    thread_id: thread.id,
    final_response: truncate(turn.finalResponse || ""),
    pre_existing_repo_changes: preExistingRepoChanges,
    changed_files: changedFiles,
    source_diff_stat: changedFiles.join("\n"),
    implementation_working_directory: workingRoot,
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
    "src/agent/codexPermissions.js",
    "src/agent/implementationMode.js",
    "src/agent/memoryStore.js",
    "src/agent/publicationSafety.js",
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

async function readGitRoot(cwd = projectRoot()) {
  const root = await runCommand("git", ["rev-parse", "--show-toplevel"], {
    allowFailure: true,
    cwd
  });
  return {
    ok: root.ok,
    command: root,
    gitRoot: root.ok ? root.stdout.trim() : null
  };
}

async function readRepoChanges(cwd = projectRoot()) {
  const root = await readGitRoot(cwd);
  if (!root.ok) {
    return {
      ok: false,
      status: root.command,
      files: [],
      gitRoot: null
    };
  }

  const status = await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    allowFailure: true,
    cwd: root.gitRoot
  });
  return {
    ok: status.ok,
    status,
    files: status.ok ? status.stdout.split(/\r?\n/).filter(Boolean) : [],
    gitRoot: root.gitRoot
  };
}

async function readGitPublicationPrivacyReview(cwd = projectRoot()) {
  const root = await readGitRoot(cwd);
  if (!root.ok) {
    return {
      ok: false,
      summary: "Publication privacy review failed because git root could not be read.",
      gitRoot: null,
      git_root_status: root.command,
      blocking_findings: [
        {
          scope: "git_root",
          path: null,
          matched_rule: "git repository unavailable"
        }
      ],
      historical_findings: [],
      requires_history_remediation: false
    };
  }

  const gitRoot = root.gitRoot;
  const [tracked, status, staged, unstaged, proposedCommit, latestCommit] = await Promise.all([
    runCommand("git", ["ls-files"], { allowFailure: true, cwd: gitRoot }),
    runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], { allowFailure: true, cwd: gitRoot }),
    runCommand("git", ["diff", "--cached", "--name-only"], { allowFailure: true, cwd: gitRoot }),
    runCommand("git", ["diff", "--name-only"], { allowFailure: true, cwd: gitRoot }),
    runCommand("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRT"], { allowFailure: true, cwd: gitRoot }),
    runCommand("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], {
      allowFailure: true,
      cwd: gitRoot
    })
  ]);

  const commandFailures = [tracked, status, staged, unstaged, proposedCommit].filter((result) => !result.ok);
  if (commandFailures.length > 0) {
    return {
      ok: false,
      summary: "Publication privacy review failed because git inspection failed.",
      gitRoot,
      command_failures: commandFailures,
      blocking_findings: [
        {
          scope: "git_inspection",
          path: null,
          matched_rule: "git inspection unavailable"
        }
      ],
      historical_findings: [],
      requires_history_remediation: false
    };
  }

  const statusPaths = String(status.stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .flatMap(extractPorcelainPaths);
  const review = createPublicationPrivacyReview({
    trackedPaths: splitGitOutputLines(tracked.stdout),
    statusPaths,
    stagedPaths: splitGitOutputLines(staged.stdout),
    unstagedDiffPaths: splitGitOutputLines(unstaged.stdout),
    proposedCommitPaths: splitGitOutputLines(proposedCommit.stdout),
    latestCommitPaths: latestCommit.ok ? splitGitOutputLines(latestCommit.stdout) : []
  });

  return {
    ...review,
    gitRoot,
    summary: summarizePublicationPrivacyReview(review)
  };
}

function blockedGitResult(summary, privacyReview, extra = {}) {
  return {
    ok: false,
    summary,
    committed: false,
    pushed: false,
    privacy_review: privacyReview,
    ...extra
  };
}

function validationWithGitFailure(validationResult, gitResult) {
  if (!gitResult || gitResult.ok === true) {
    return validationResult;
  }

  return {
    ...validationResult,
    ok: false,
    errors: [...(validationResult.errors || []), `Git publication failed: ${gitResult.summary}`],
    git_publication_result: {
      ok: gitResult.ok,
      summary: gitResult.summary,
      committed: gitResult.committed === true,
      pushed: gitResult.pushed === true,
      privacy_review: gitResult.privacy_review || null
    }
  };
}

export async function runGitIfRequested(record, preExistingRepoChanges = [], cwd = projectRoot()) {
  if (!record.git_commit_requested && !record.git_push_requested) {
    return {
      ok: true,
      summary: "Git commit/push not requested.",
      committed: false,
      pushed: false
    };
  }

  const commitMessage = typeof record.git_commit_message === "string" ? record.git_commit_message.trim() : "";
  if (!commitMessage) {
    return {
      ok: false,
      summary: "Git commit/push requires a commit message.",
      committed: false,
      pushed: false
    };
  }

  const changed = await readRepoChanges(cwd);
  if (!changed.ok) {
    return {
      ok: false,
      summary: "Git status failed.",
      committed: false,
      pushed: false,
      status: changed.status
    };
  }

  const gitRoot = changed.gitRoot || cwd;
  const privacyReviewBeforeAdd = await readGitPublicationPrivacyReview(gitRoot);
  if (!privacyReviewBeforeAdd.ok) {
    return blockedGitResult(privacyReviewBeforeAdd.summary, privacyReviewBeforeAdd, {
      pre_existing_repo_changes: preExistingRepoChanges
    });
  }

  if (changed.files.length === 0) {
    return {
      ok: true,
      summary: "No repository changes to commit or push.",
      committed: false,
      pushed: false,
      privacy_review: privacyReviewBeforeAdd,
      pre_existing_repo_changes: preExistingRepoChanges
    };
  }

  const add = await runCommand("git", ["add", "-A"], { allowFailure: true, cwd: gitRoot });
  if (!add.ok) {
    return {
      ok: false,
      summary: "Git add failed.",
      committed: false,
      pushed: false,
      privacy_review: privacyReviewBeforeAdd,
      add
    };
  }

  const privacyReviewAfterAdd = await readGitPublicationPrivacyReview(gitRoot);
  if (!privacyReviewAfterAdd.ok) {
    return blockedGitResult(privacyReviewAfterAdd.summary, privacyReviewAfterAdd, {
      pre_existing_repo_changes: preExistingRepoChanges,
      add
    });
  }

  const commit = await runCommand("git", ["commit", "-m", commitMessage], {
    allowFailure: true,
    cwd: gitRoot
  });
  if (!commit.ok) {
    return {
      ok: false,
      summary: "Git commit failed.",
      committed: false,
      pushed: false,
      privacy_review: privacyReviewAfterAdd,
      pre_existing_repo_changes: preExistingRepoChanges,
      commit
    };
  }

  const push = await runCommand("git", ["push"], { allowFailure: true, cwd: gitRoot });
  return {
    ok: push.ok,
    summary: push.ok ? "Committed and pushed repository changes." : "Commit succeeded but git push failed.",
    committed: true,
    pushed: push.ok,
    privacy_review: privacyReviewAfterAdd,
    pre_existing_repo_changes: preExistingRepoChanges,
    commit,
    push
  };
}

export async function runAutonomousImplementation(recordId) {
  let entered = null;
  let snapshotRoot = null;
  let dataSnapshotRoot = null;
  let implementationResult = null;
  let initialContinuityValidation = null;
  try {
    entered = await enterImplementationMode(recordId);
    const preExistingRepoChanges = await readRepoChanges();
    initialContinuityValidation = await validateContinuityData();
    if (!initialContinuityValidation.ok) {
      const error = new Error("Continuity data failed validation after implementation mode entry.");
      error.details = initialContinuityValidation.errors;
      throw error;
    }
    snapshotRoot = await createCodeSnapshot(recordId);
    dataSnapshotRoot = await createContinuityDataSnapshot(recordId);
    implementationResult = await runCodexImplementation(
      entered.record,
      entered.handoff,
      preExistingRepoChanges.ok ? preExistingRepoChanges.files : [],
      snapshotRoot
    );
    const postImplementationContinuityValidation = await validateContinuityData();
    let validationResult = withContinuityChecks(
      await runPostChangeValidation(projectRoot()),
      [
        continuityCheck("after_implementation_mode_entry", initialContinuityValidation),
        continuityCheck("after_live_implementation", postImplementationContinuityValidation)
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

    const postValidationContinuityValidation = await validateContinuityData();
    validationResult = withContinuityChecks(
      await runPostChangeValidation(projectRoot()),
      [
        continuityCheck("after_implementation_mode_entry", initialContinuityValidation),
        continuityCheck("after_live_implementation", postImplementationContinuityValidation),
        continuityCheck("after_live_validation", postValidationContinuityValidation)
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

    const gitResult = await runGitIfRequested(entered.record, preExistingRepoChanges.ok ? preExistingRepoChanges.files : []);
    const finalValidationResult = validationWithGitFailure(validationResult, gitResult);
    const finalStatus = finalValidationResult.ok ? "validated" : "failed_validation";
    const record = await recordImplementationModeResult({
      recordId,
      status: finalStatus,
      implementationResult,
      validationResult: finalValidationResult,
      rollbackResult: null,
      gitResult
    });
    return {
      ok: finalValidationResult.ok && gitResult.ok,
      record,
      implementationResult,
      validationResult: finalValidationResult,
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
