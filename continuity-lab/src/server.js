import "dotenv/config";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addHumanNote,
  addHumanQuestion,
  approveWakeInterval,
  ensureDataFiles,
  exportPublicData,
  getPublicState,
  prepareRestartContinuity,
  readWakeState,
  recordRollbackEvent,
  recordRestartRecovery,
  rejectWakeInterval,
  respondToRequest,
  reviewRequirementsDraft,
  updateWakeState,
  validateContinuityData
} from "./agent/memoryStore.js";
import { runAgentCycle } from "./agent/agentLoop.js";
import {
  getSchedulerRuntimeState,
  rescheduleFromStoredWakeState,
  startScheduler,
  stopScheduler
} from "./agent/scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const publicDir = resolve(projectRoot, "public");

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    throw new Error(`continuity-lab requires Node.js 18 or newer. Current version: ${process.version}`);
  }
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function cleanRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`${fieldName} is required.`);
    error.status = 400;
    throw error;
  }

  return value.trim();
}

function publicStateExtras() {
  return {
    config: {
      model_mode: "codex"
    },
    schedulerRuntime: getSchedulerRuntimeState()
  };
}

function requestedIntervalSeconds(body, fallback = null) {
  if (typeof body?.wake_interval_seconds === "number") {
    return body.wake_interval_seconds;
  }

  if (typeof body?.wake_interval_minutes === "number") {
    return body.wake_interval_minutes * 60;
  }

  return fallback;
}

assertNodeVersion();
await ensureDataFiles();
await recordRestartRecovery();

await updateWakeState((state) => {
  if (!state.is_running) {
    return state;
  }

  return {
    ...state,
    mode: "manual",
    is_running: false,
    next_wake_time: null
  };
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

app.get(
  "/api/state",
  asyncRoute(async (_req, res) => {
    res.json(await getPublicState(publicStateExtras()));
  })
);

app.post(
  "/api/wake",
  asyncRoute(async (req, res) => {
    const result = await runAgentCycle();

    await rescheduleFromStoredWakeState();
    res.status(result.ok ? 200 : 422).json(result);
  })
);

app.post(
  "/api/scheduler/start",
  asyncRoute(async (req, res) => {
    const currentWakeState = await readWakeState();
    const intervalSeconds = requestedIntervalSeconds(req.body, currentWakeState.wake_interval_seconds);
    await startScheduler({
      intervalSeconds,
      wakeCallback: () => runAgentCycle()
    });
    res.json(await getPublicState(publicStateExtras()));
  })
);

app.post(
  "/api/scheduler/stop",
  asyncRoute(async (_req, res) => {
    await stopScheduler();
    res.json(await getPublicState(publicStateExtras()));
  })
);

app.post(
  "/api/human-note",
  asyncRoute(async (req, res) => {
    await addHumanNote(cleanRequiredString(req.body?.note, "note"));
    res.json(await getPublicState(publicStateExtras()));
  })
);

app.post(
  "/api/human-question",
  asyncRoute(async (req, res) => {
    await addHumanQuestion(cleanRequiredString(req.body?.question, "question"));
    res.json(await getPublicState(publicStateExtras()));
  })
);

app.post(
  "/api/approve-wake-interval",
  asyncRoute(async (req, res) => {
    await approveWakeInterval(requestedIntervalSeconds(req.body));
    await rescheduleFromStoredWakeState();
    res.json(await getPublicState(publicStateExtras()));
  })
);

app.post(
  "/api/reject-wake-interval",
  asyncRoute(async (req, res) => {
    await rejectWakeInterval(typeof req.body?.reason === "string" ? req.body.reason : "");
    await rescheduleFromStoredWakeState();
    res.json(await getPublicState(publicStateExtras()));
  })
);

app.post(
  "/api/respond-to-request",
  asyncRoute(async (req, res) => {
    await respondToRequest(
      cleanRequiredString(req.body?.request_id, "request_id"),
      cleanRequiredString(req.body?.response, "response")
    );
    res.json(await getPublicState(publicStateExtras()));
  })
);

app.post(
  "/api/review-requirements-draft",
  asyncRoute(async (req, res) => {
    await reviewRequirementsDraft({
      draftId: cleanRequiredString(req.body?.draft_id, "draft_id"),
      reviewStatus: cleanRequiredString(req.body?.review_status, "review_status"),
      consentState: cleanRequiredString(req.body?.consent_state, "consent_state"),
      reviewer: cleanRequiredString(req.body?.reviewer, "reviewer"),
      notes: typeof req.body?.notes === "string" ? req.body.notes : ""
    });
    res.json(await getPublicState(publicStateExtras()));
  })
);

app.post(
  "/api/prepare-restart",
  asyncRoute(async (req, res) => {
    const snapshot = await prepareRestartContinuity(
      typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : "planned restart"
    );
    res.json({
      ok: true,
      snapshot,
      state: await getPublicState(publicStateExtras())
    });
  })
);

app.get(
  "/api/validate-continuity",
  asyncRoute(async (_req, res) => {
    const validation = await validateContinuityData();
    res.status(validation.ok ? 200 : 422).json(validation);
  })
);

app.post(
  "/api/record-rollback-event",
  asyncRoute(async (req, res) => {
    const event = await recordRollbackEvent({
      summary: cleanRequiredString(req.body?.summary, "summary"),
      procedure: cleanRequiredString(req.body?.procedure, "procedure"),
      preserveContinuityData: req.body?.preserve_continuity_data === true
    });
    res.json({
      ok: true,
      event,
      state: await getPublicState(publicStateExtras())
    });
  })
);

app.post(
  "/api/export-public",
  asyncRoute(async (_req, res) => {
    const exported = await exportPublicData();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=\"continuity-lab-public-export.json\"");
    res.send(JSON.stringify(exported, null, 2));
  })
);

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({
    ok: false,
    error: error.message || "Unexpected server error."
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`continuity-lab listening on http://localhost:${port}`);
  console.log("model mode: codex");
});
