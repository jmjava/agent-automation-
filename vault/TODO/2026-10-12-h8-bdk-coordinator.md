---
status: open
project: agent-automation
kind: epic
wave: 5
harness: h8-bdk-coordinator
pattern: hub-and-spoke
trends: T4 T10 T14 T13
---

# H8 bdk-coordinator: hub-and-spoke with a durable BDK hub

Proves a durable hub with key-value memory can own a pool across process restarts. Last in the order because it adds a runtime (`@cursor/bdk`) and benefits from every gate already existing as a function.

## Owns these Agent Queue lines

H8.1 through H8.6.

## Behavior

1. `bot/agent.ts` hub; `bot/instructions.md` always-on prompt; Node 22, never Bun.
2. Entry points: Slack `/pool run <project>`; GitHub issue label `pool`.
3. Server tools wrap H1 board logic and H3 gates (`execution: "server"`, JSON-shaped returns).
4. Pool state lives in `ctx.host.kv` keyed `pool/<runId>/...` with `exp`; no module globals; every write idempotent (no CAS available).
5. Spokes are Cloud Agents created through the API; the hub never edits code.
6. Decisions are recorded with an authored tool and acted on from a `turn.completed` hook, not inside the tool.
7. Results table posted back to the channel; receipt and trace as everywhere else.

## Files

`harnesses/h8-bdk-coordinator/bot/agent.ts`, `bot/instructions.md`, `bot/tools/*.ts`, `bot/channels/*.ts`, `bot/hooks/*.ts`, `evals/**/*.eval.ts` at project root, `README.md`.

## Offline mode

`bdk validate`, `bdk run`, `bdk eval` against recorded channel events with the scripted spoke backend.

## Done when

`bdk validate` passes; one Slack-triggered pool run completes end to end with the hub process restarted mid-run and no duplicated spoke; evals pass in CI.
