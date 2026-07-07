import { applySuccessfulCycle, getPublicState, loadCycleState, recordFailedCycle } from "./memoryStore.js";
import { buildAgentCyclePrompt } from "./agentPrompt.js";
import { parseStrictJson, validateAgentOutput } from "../utils/validateJson.js";

let cycleInProgress = false;

function rawOutputForFailure(adapterResult) {
  if (!adapterResult) {
    return "";
  }

  if (typeof adapterResult === "string") {
    return adapterResult;
  }

  if (typeof adapterResult.text === "string") {
    return adapterResult.text;
  }

  return JSON.stringify(adapterResult.raw ?? adapterResult);
}

export async function runAgentCycle() {
  if (cycleInProgress) {
    return {
      ok: false,
      error: "A wake cycle is already running."
    };
  }

  const mode = "codex";

  cycleInProgress = true;

  try {
    const state = await loadCycleState();
    const prompt = buildAgentCyclePrompt(state);
    const adapterResult = await import("./codexAdapter.js").then((adapter) => adapter.runCodexCycle({ prompt }));

    const finalText = typeof adapterResult === "string" ? adapterResult : adapterResult.text;
    const parsed = parseStrictJson(finalText);
    if (!parsed.ok) {
      await recordFailedCycle({
        mode,
        rawOutput: rawOutputForFailure(adapterResult),
        error: parsed.error
      });
      return {
        ok: false,
        parsingFailure: true,
        error: parsed.error,
        state: await getPublicState()
      };
    }

    const validation = validateAgentOutput(parsed.value);
    if (!validation.ok) {
      await recordFailedCycle({
        mode,
        rawOutput: rawOutputForFailure(adapterResult),
        error: "Model JSON did not match the required schema.",
        details: validation.errors
      });
      return {
        ok: false,
        parsingFailure: true,
        error: "Model JSON did not match the required schema.",
        details: validation.errors,
        state: await getPublicState()
      };
    }

    let journalEntry;
    let implementationResult = null;
    try {
      journalEntry = await applySuccessfulCycle({
        mode,
        output: validation.value
      });

      if (
        validation.value.self_edit_request?.type === "request_implementation_mode" &&
        journalEntry.self_edit_request_record_id
      ) {
        implementationResult = await import("./implementationMode.js").then((implementation) =>
          implementation.runAutonomousImplementation(journalEntry.self_edit_request_record_id)
        );
      }
    } catch (error) {
      await recordFailedCycle({
        mode,
        rawOutput: rawOutputForFailure(adapterResult),
        error: error.message || "Validated model output could not be applied.",
        details: error.details || []
      });
      return {
        ok: false,
        parsingFailure: false,
        error: error.message || "Validated model output could not be applied.",
        details: error.details || [],
        state: await getPublicState()
      };
    }

    return {
      ok: true,
      journalEntry,
      implementationResult,
      state: await getPublicState()
    };
  } finally {
    cycleInProgress = false;
  }
}
