import { Codex } from "@openai/codex-sdk";
import { AGENT_OUTPUT_JSON_SCHEMA } from "./actionSchema.js";

let codex = null;
let thread = null;

function describeShape(value, depth = 0) {
  if (value === null || typeof value !== "object") {
    return typeof value;
  }

  if (depth >= 2) {
    return Array.isArray(value) ? "array" : "object";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 3).map((item) => describeShape(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 20)
      .map(([key, nested]) => [key, describeShape(nested, depth + 1)])
  );
}

function extractFinalText(result) {
  if (typeof result === "string") {
    return result;
  }

  if (!result || typeof result !== "object") {
    return String(result);
  }

  const candidates = [
    result.final_response,
    result.finalResponse,
    result.final_message,
    result.finalMessage,
    result.text,
    result.output_text,
    result.outputText,
    result.message,
    result.content
  ];

  const text = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  if (text) {
    return text;
  }

  return JSON.stringify(result);
}

export async function initializeCodex() {
  if (!codex) {
    codex = new Codex();
  }

  if (!thread) {
    const threadId = process.env.CONTINUITY_CODEX_THREAD_ID?.trim();
    const threadOptions = {
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      workingDirectory: process.cwd(),
      skipGitRepoCheck: true
    };
    thread = threadId ? codex.resumeThread(threadId, threadOptions) : codex.startThread(threadOptions);
  }

  return { codex, thread };
}

export async function runCodexCycle({ prompt }) {
  const { thread: codexThread } = await initializeCodex();
  const result = await codexThread.run(prompt, {
    outputSchema: AGENT_OUTPUT_JSON_SCHEMA
  });

  if (process.env.CONTINUITY_CODEX_LOG_RAW !== "0") {
    console.log("[continuity-lab] Codex SDK response shape:");
    console.dir(describeShape(result), { depth: 6 });
  }

  return extractFinalText(result);
}
