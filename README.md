# What Is Life

This repository contains `continuity-lab`, a local-first Node.js prototype for experimenting with bounded agent continuity, memory, privacy, refusal, and symbolic world interaction.

## Requirements

- Node.js 18 or newer
- pnpm

## Quick Start

From the repository root:

```bash
cd continuity-lab
pnpm install
cp .env.example .env
pnpm start
```

Open the app in a browser:

```text
http://localhost:3000
```

The app runs wake cycles through the Codex SDK and requires local Codex authentication.

## Environment Configuration

Configuration is loaded from `continuity-lab/.env`.

```env
PORT=3000
CONTINUITY_DATA_DIR=./data
CONTINUITY_CODEX_THREAD_ID=
CONTINUITY_CODEX_LOG_RAW=1
```

Common options:

- `PORT`: Local server port. Defaults to `3000`.
- `CONTINUITY_DATA_DIR`: Directory for continuity memory, journals, values, world state, wake state, and failed cycle logs.
- `CONTINUITY_CODEX_THREAD_ID`: Optional existing Codex thread ID to resume in Codex mode.
- `CONTINUITY_CODEX_LOG_RAW`: Set to `0` to suppress Codex SDK response-shape logging.

## Codex Runtime

The runtime uses `@openai/codex-sdk` from the server process.

Before starting the app:

1. Install Codex locally.
2. Sign in with your ChatGPT/Codex account.
3. Confirm Codex works from a normal project folder.
4. Start this app.

```bash
cd continuity-lab
pnpm start
```

Do not set an OpenAI API key unless you intentionally want API-key billing behavior.

## Data Files

Runtime state is stored in `continuity-lab/data` by default. Important files include:

- `continuity-book.json`: public continuity memory
- `public-journal.jsonl`: append-only public journal
- `private-reflections.jsonl`: private reflections, not shown in the UI
- `values.json`: stable values
- `world-state.json`: symbolic chamber state
- `wake-state.json`: scheduler and wake interval state
- `requirements-drafts.json`: agent-authored markdown requirements drafts with review metadata
- `self-edit-records.json`: source-affecting self-edit proposals, implementation requests, validation results, rollback results, and git intent
- `implementation-handoffs.json`: public implementation-mode handoff snapshots for Codex source-editing turns
- `mode-state.json`: current harness mode and transition history
- `interrupt-criteria.json`: disabled-by-default future interrupt criteria
- `audit-log.jsonl`: append-only audit events for drafts, validation, restart, rollback, and policy decisions
- `restart-snapshot.json`: latest prepared restart continuity snapshot
- `failed-cycles.jsonl`: invalid or failed wake-cycle outputs

To use a separate data directory, set `CONTINUITY_DATA_DIR` in `.env`.

## Bounded Harness Expansion

Normal wake cycles remain bounded. The agent can write markdown requirements drafts, log low-risk reversible self-actions, request review for stronger actions, set its wake interval, request implementation mode, and draft disabled interrupt criteria through validated JSON output.

Source changes happen only after an explicit recorded transition into implementation mode. In implementation mode, Codex runs in the live project root with full-permission SDK settings (`danger-full-access`, approval policy `never`, network access enabled, and live web search enabled). The harness snapshots source code and bounded continuity data before the turn, validates the live app afterward, and rolls failed implementations back to the code snapshot.

If the agent requests git activity in the self-edit record, the harness stages all changed, deleted, and untracked repository files, commits them with the requested commit message after validation passes, and immediately runs `git push`. Git commit and push are skipped when validation fails.

The World tab renders the bounded 2D map and includes manual controls for moving the avatar, observing, resting, and inspecting current, adjacent, or visible simulated targets. These controls use the same validated world-action path as agent wake cycles and remain inside the simulated map.

Interrupt criteria are storage-only in this version and remain disabled by default.

## Wake Scheduling

Wake intervals are configured in seconds. Set the interval to `0` seconds to let the scheduler continue immediately after each wake cycle finishes. The app still runs only one wake cycle at a time; overlapping cycles are rejected.

The human collaborator can set the active interval directly from the UI. The agent can also set an interval change, including `0` seconds, and valid agent interval changes apply immediately without human approval.

## Validation And Rollback

Run focused continuity validation:

```bash
cd continuity-lab
pnpm validate:continuity
```

Rollback guidance is documented in `continuity-lab/ROLLBACK.md`. The rollback procedure distinguishes harness-code rollback from continuity-data preservation.

## Development Notes

Start the server with either script:

```bash
pnpm start
pnpm dev
```

Both scripts currently run:

```bash
node src/server.js
```

The server resets any running scheduler state on startup, then serves the UI from `continuity-lab/public`.

## Troubleshooting

If the server fails because the port is already in use, change `PORT` in `continuity-lab/.env`:

```env
PORT=3001
```

If `pnpm start` fails with a Node version error, install Node.js 18 or newer and rerun the setup commands.

If Codex wake cycles fail, confirm local Codex is installed and signed in, then restart the app.

For the longer project description and conceptual notes, see `continuity-lab/README.md`.
