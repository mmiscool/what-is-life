const PRIVATE_DATA_FILE_PREFIXES = ["private-reflections", "hidden-goals"];
const PRIVATE_DATA_DIRECTORIES = ["private-memory", "private-reflections", "hidden-goals"];

function normalizeGitPath(filePath) {
  return String(filePath || "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function privatePathMatch(normalizedPath) {
  const parts = normalizedPath.split("/").filter(Boolean);
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] !== "data") {
      continue;
    }

    const next = parts[index + 1];
    if (PRIVATE_DATA_DIRECTORIES.includes(next)) {
      return `data/${next}`;
    }

    if (PRIVATE_DATA_FILE_PREFIXES.some((prefix) => next === `${prefix}.jsonl` || next.startsWith(`${prefix}.`))) {
      return `data/${next}`;
    }
  }

  return null;
}

export function isPrivatePublicationPath(filePath) {
  return privatePathMatch(normalizeGitPath(filePath)) !== null;
}

export function privatePublicationPathInfo(filePath) {
  const normalizedPath = normalizeGitPath(filePath);
  const matchedRule = privatePathMatch(normalizedPath);
  return matchedRule
    ? {
        path: normalizedPath,
        matched_rule: matchedRule
      }
    : null;
}

function addFindings(findings, scope, paths) {
  for (const path of paths || []) {
    const info = privatePublicationPathInfo(path);
    if (info) {
      findings.push({
        scope,
        path: info.path,
        matched_rule: info.matched_rule
      });
    }
  }
}

export function extractPorcelainPaths(line) {
  if (typeof line !== "string" || line.length < 4) {
    return [];
  }

  const status = line.slice(0, 2);
  if (line[2] !== " " || !/^[ MADRCU?!]{2}$/.test(status)) {
    return [];
  }

  const rawPath = line.slice(3).trim();
  if (!rawPath) {
    return [];
  }

  if (rawPath.includes(" -> ")) {
    return rawPath.split(" -> ").map(normalizeGitPath).filter(Boolean);
  }

  return [normalizeGitPath(rawPath)].filter(Boolean);
}

export function splitGitOutputLines(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function createPublicationPrivacyReview({
  trackedPaths = [],
  statusPaths = [],
  stagedPaths = [],
  unstagedDiffPaths = [],
  proposedCommitPaths = [],
  latestCommitPaths = []
} = {}) {
  const blockingFindings = [];
  const historicalFindings = [];

  addFindings(blockingFindings, "tracked", trackedPaths);
  addFindings(blockingFindings, "status", statusPaths);
  addFindings(blockingFindings, "staged", stagedPaths);
  addFindings(blockingFindings, "unstaged_diff", unstagedDiffPaths);
  addFindings(blockingFindings, "proposed_commit_diff", proposedCommitPaths);
  addFindings(historicalFindings, "latest_commit", latestCommitPaths);

  const uniqueBlockingFindings = uniqueFindings(blockingFindings);
  const uniqueHistoricalFindings = uniqueFindings(historicalFindings);
  return {
    ok: uniqueBlockingFindings.length === 0,
    checked_rules: [
      "data/private-reflections.jsonl",
      "data/private-reflections.*",
      "data/private-memory/",
      "data/hidden-goals.jsonl",
      "data/hidden-goals.*"
    ],
    blocking_findings: uniqueBlockingFindings,
    historical_findings: uniqueHistoricalFindings,
    requires_history_remediation: uniqueHistoricalFindings.length > 0
  };
}

function uniqueFindings(findings) {
  const seen = new Set();
  const unique = [];
  for (const finding of findings) {
    const key = `${finding.scope}:${finding.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(finding);
    }
  }
  return unique;
}

export function summarizePublicationPrivacyReview(review) {
  if (!review) {
    return "Publication privacy review was not run.";
  }

  if (review.ok) {
    return review.requires_history_remediation
      ? "Publication privacy review passed for the proposed commit; prior history still needs private-data remediation planning."
      : "Publication privacy review passed.";
  }

  const scopes = [...new Set(review.blocking_findings.map((finding) => finding.scope))].join(", ");
  return `Publication privacy review failed closed for private memory paths (${scopes || "unknown scope"}).`;
}
