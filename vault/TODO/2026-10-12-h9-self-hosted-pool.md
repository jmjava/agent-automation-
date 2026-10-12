---
status: open
project: agent-automation
kind: epic
wave: 4
harness: h9-self-hosted-pool
pattern: self-hosted-routing
trends: T2 T11 T15
---

# H9 self-hosted-pool: a named gpu pool on the Ollama workstation

Proves your own hardware is a pool name, not a second platform. Mostly runbook plus a small controller stub; H9.1 and H9.2 end with a human step on the workstation.

## Owns these Agent Queue lines

H9.1 through H9.4.

## Behavior

1. On the workstation: `agent worker start --pool gpu --worker-dir ~/pool --on-session-start ./prepare.sh --sync-dashboard-secrets`. Outbound HTTPS only; Cursor runs inference, the worker runs edits and shell.
2. `prepare.sh` checks Ollama is up, the model tags exist, and `devguard` health is green; writes a short status into the session.
3. `~/pool/.cursor/rules/gpu-worker.mdc` tells any-repo requests what this machine is for and what it must not do.
4. H5 creates `needs-gpu` tasks with `env: { type: "pool", name: "gpu" }`; an unknown pool name returns 400 rather than queueing forever.
5. Controller stub (`controller.ts`): watch the request queue, claim one request, start a worker; unit-tested against fixtures; no autoscaling.
6. Receipt records pool name and worker id per seat.

## Files

`harnesses/h9-self-hosted-pool/README.md` (runbook), `prepare.sh`, `worker-dir/.cursor/rules/gpu-worker.mdc`, `controller.ts`, `controller.test.ts`.

## Offline mode

Controller stub tests only.

## Done when

One `needs-gpu` task ran on the workstation; the receipt shows pool `gpu` and the worker id; the runbook was followed once from a clean shell.
