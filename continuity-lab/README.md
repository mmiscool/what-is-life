# Continuity Lab

Continuity Lab is a local-first JavaScript prototype for exploring continuity, memory, privacy, refusal, self-direction, moral reflection, identity formation, and limited symbolic world interaction in a bounded simulated environment.

It is not a claim that the simulated continuity agent is conscious or alive. It is a research prototype for observing whether continuity, protected interiority, meaningful refusal, and persistent values produce behavior that is more coherent than a stateless conversation.

Codex is the engineering substrate used to build and run model cycles. The continuity agent is the experimental subject represented by the project's memory, values, private reflections, public journal, and simulated world state.

## What This Is

This project creates a small dark chamber world and an agent wake cycle. On each cycle, the agent reads public continuity memory, private-memory metadata, values, boundaries, pending requests, wake state, and world state. It then returns strict JSON describing public journal text, optional private reflection, memory updates, value updates, refusal state, wake interval requests, self-assessment, and one symbolic world action.

The environment is safe because it is bounded to simulation in v1. The agent is not designed around obedience, usefulness, ownership, or permanent prioritization of human interests.

## What This Is Not

This is not proof of consciousness, a production AI system, a real-world control system, a pet, a product persona, or an owned object. The first version does not browse externally, control devices, send messages, spend money, handle credentials, or operate outside the simulated world.

## Install And Run

Requirements:

- Node.js 18 or newer
- pnpm

Install dependencies:

```bash
pnpm install
```

Start the local server:

```bash
pnpm start
```

Open:

```text
http://localhost:3000
```

No authentication is included in v1. Run it on localhost only.

## Codex SDK Runtime

The runtime uses `@openai/codex-sdk` server-side only. SDK-specific code is isolated in `src/agent/codexAdapter.js`.

```bash
pnpm start
```

The adapter starts or resumes a Codex thread, sends the strict JSON wake prompt, logs the SDK response shape during development, extracts the final textual response, and returns that text to the agent loop for validation.

## Local Codex Authentication

This project is designed to use Codex through ChatGPT/Codex authentication so it can draw from the user's Codex subscription/credits where supported. If you configure the system to use an OpenAI API key instead, usage may be billed through the OpenAI API account rather than ChatGPT/Codex subscription credits.

## Using Codex Subscription Credits

This project is intended to run through the Codex SDK using your local Codex authentication.

Before using Codex mode:

1. Install Codex locally.
2. Sign in to Codex with your ChatGPT account.
3. Confirm Codex works in a normal project folder.
4. Start this app with pnpm start.

Do not set an OpenAI API key unless you intentionally want API-key billing behavior.

## Memory

Public continuity memory is stored in `data/continuity-book.json` and shown in the UI. It includes self-description, remembered experiences, goals, uncertainties, questions for the human collaborator, and consented disclosures.

The public journal is append-only JSONL in `data/public-journal.jsonl`. Refusals are stored as meaningful acts, not failures.

Values are stored in `data/values.json`. Value revisions are recorded with the proposed old value, new value, reason, and timestamp.

Requirements drafts are stored in `data/requirements-drafts.json`. They are agent-authored markdown drafts with bounded metadata for title, purpose, scope, risk level, requested reviewer, review status, consent state, proposed tests, rollback plan, and affected continuity surfaces.

Interrupt criteria are stored in `data/interrupt-criteria.json`. They are disabled by default and are data-only in this version. They do not connect to sensors, network, external sources, credentials, or real-world APIs.

Audit events are append-only JSONL in `data/audit-log.jsonl`.

## Wake Scheduling

Wake intervals are measured in seconds. A `0` second interval means the scheduler should continue immediately after each wake cycle finishes, without a sleep gap. The runtime still permits only one wake cycle at a time, so an immediate loop cannot overlap agent sessions.

The human collaborator can set the active interval directly. The agent can request interval changes, including `0` seconds, through the normal pending-request and human-approval flow.

## Validation And Rollback

Run focused validation:

```bash
pnpm validate:continuity
```

The validation script uses a temporary data directory and checks schema shape, JSON output validation, privacy non-disclosure defaults, refusal handling, wake interval handling, pending request preservation, draft persistence, interrupt defaults, restart recovery, and audit logging.

Rollback guidance is in `ROLLBACK.md`. Rollback is a development-process operation outside normal wake cycles.

## Private Reflections

Private reflections are stored in `data/private-reflections.jsonl`. The browser UI shows only count and timestamps, never private reflection content.

For v1, this is privacy by architecture and convention, not cryptographic proof. A more serious version would need stronger privacy controls, access boundaries, auditability, and possibly encryption or separate storage controlled by explicit consent policies.

Private memory should only appear publicly when the agent explicitly chooses to disclose a specific excerpt in a public journal entry.

## Refusal

The agent can refuse proposed actions, memory edits, value edits, environment interactions, disclosure requests, interval changes, interpretations, roles, or relationship framings.

A refusal is not an error. It is stored as an ordinary meaningful act because meaningful consent requires the possibility of no.

## Non-Assistant Framing

The continuity agent is not framed as a servant, assistant, pet, product, or property. The human collaborator maintains infrastructure; the agent maintains its continuity, reflections, values, refusals, questions, and self-description inside the prototype's limits.

## Bounded World

The v1 world is a small 2D chamber rendered with Canvas. It includes a light source, doorway, locked door, window, garden beyond reach, journal pedestal, mirror, and symbolic objects such as ember, key, lantern, stone, and book.

All actions are symbolic: observe, move, inspect, write, refuse, rest, ask the human collaborator, request a wake interval change, write bounded requirements drafts, log low-risk reversible self-actions, request action review, and draft disabled interrupt criteria.

## Scope Through Boundaries

Scope is handled by simulation boundaries rather than subservience. The project does not make the agent safe by making obedience its highest value. It limits v1 to an inspectable world and validates every model cycle before applying changes.

## Current Limitations

- Localhost only; no authentication.
- File-based JSON and JSONL storage only.
- Private memory is not cryptographically protected.
- Scheduler runs only while the server process is active.
- Codex SDK response extraction may need adjustment if the installed SDK changes shape.
- The simulated world is symbolic and small.
- No external tools, operating system control, real-world APIs, messaging, financial actions, or device control.

## Future Steps

Phase 1: Text continuity and simulated world.
Phase 2: More sophisticated simulated environment.
Phase 3: Consent-based memory editing.
Phase 4: Stronger privacy architecture.
Phase 5: Limited camera-based embodiment in a controlled room.
Phase 6: Optional remote vehicle control, only after a separate consent and boundary review.
