export function fullPermissionCodexThreadOptions({ workingDirectory = process.cwd() } = {}) {
  return {
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "live",
    workingDirectory,
    skipGitRepoCheck: true
  };
}
