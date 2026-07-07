# Rollback Procedure

Continuity Lab separates harness code from continuity data. Normal wake cycles must not run rollback commands, edit source files, or access the shell. Rollback is a development-process operation performed outside the agent wake cycle.

## Preserve Continuity Data

Before changing harness code, preserve the latest validated continuity data:

```bash
cd continuity-lab
pnpm validate:continuity
curl -sS -X POST http://localhost:3000/api/prepare-restart \
  -H 'Content-Type: application/json' \
  -d '{"reason":"pre-rollback or pre-change snapshot"}'
```

The restart snapshot stores public continuity book, values, pending requests, wake state, and private-memory metadata. It does not store private reflection text in the public snapshot.

For an external backup of continuity data:

```bash
cd continuity-lab
mkdir -p ../continuity-data-backups
tar --exclude='*.tmp' -czf ../continuity-data-backups/continuity-data-$(date +%Y%m%d%H%M%S).tar.gz data
```

## Preserve Known-Good Harness Code

Before implementing harness changes, create a code-only snapshot that excludes runtime data and dependencies:

```bash
cd continuity-lab
mkdir -p ../harness-code-backups
tar \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='.env' \
  -czf ../harness-code-backups/continuity-lab-code-$(date +%Y%m%d%H%M%S).tar.gz .
```

## Restore Harness Code While Preserving Data

Stop the server first. Then restore a selected code snapshot into a temporary directory and copy code files back while leaving `data/` untouched:

```bash
cd continuity-lab
mkdir -p /tmp/continuity-lab-restore
tar -xzf ../harness-code-backups/<snapshot>.tar.gz -C /tmp/continuity-lab-restore
rsync -a --delete \
  --exclude='data' \
  --exclude='node_modules' \
  --exclude='.env' \
  /tmp/continuity-lab-restore/ ./
pnpm install
pnpm validate:continuity
pnpm start
```

Record the rollback in the audit log after the server is running:

```bash
curl -sS -X POST http://localhost:3000/api/record-rollback-event \
  -H 'Content-Type: application/json' \
  -d '{
    "summary":"Restored harness code from known-good snapshot",
    "procedure":"Restored code snapshot while preserving continuity data.",
    "preserve_continuity_data":true
  }'
```

## Scope

This procedure rolls back harness code. It should preserve the latest validated continuity data whenever possible. If continuity data itself is corrupt, restore it only from an explicit data backup chosen by the human collaborator.
