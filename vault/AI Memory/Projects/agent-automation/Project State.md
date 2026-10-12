---
type: project-state
project: agent-automation
updated: 2026-10-12T00:00:00
---

# Project State

## Objective

Build nine demo harnesses that automate pools of Cursor agents, each reusing what we already own: the Obsidian developer-memory MCP as the task board, SDLC-SPDD as the inner-loop contract, the slm-setup router and apply gate, and the dogfood-api spend-lock recipe. Every harness runs offline first with a scripted backend, produces one receipt and one trace per pool run, and treats "done" as every check success.

## Current State

Planning complete. `docs/survey.md`, `docs/cursor-techniques.md`, `docs/existing-assets.md`, and `docs/plan.md` are on the repo. No code under `harness/` or `harnesses/` yet. Wave 1 is the shared foundation library (F1–F13); H1 queue-pool is the first harness.

## Architecture

- Orchestrators and gates only; the editing loop is always Cursor (SDK, API, Automation, CLI)
- `harness/` shared TypeScript library on Node 22 with `@cursor/sdk`; scripted backend for CI
- The vault is the board; only the coordinator process holds `OBSIDIAN_VAULT_PATH`
- Pool cap 7 with refill on seat exit (`quality_pool_flow`)
- Stop after the same verify error twice; shelf, never a third automatic attempt
- One JSON receipt plus one OTel `invoke_workflow` trace per pool run; receipts are the eval baseline

## Completed

- Survey of current techniques (15 trends) with sources
- Dedicated Cursor techniques reference
- Inventory of reusable jmjava repositories and gaps
- Nine-harness plan with shared library, order, non-goals, and open questions
- Vault task lists: Agent Queue, this Project State, one TODO note per harness

## In Progress

## Blocked

- Reading the private orchestration repo (Uberorchbot per the SPDD notes): 404 for the agent token; plan relies on second-hand notes
- H2.4 and H9 require manual dashboard and workstation steps a cloud agent cannot perform

## Next Steps

- F1 Scaffold Node 22 TypeScript workspace with @cursor/sdk, vitest, eslint, and a tests.yml CI workflow #pool #foundation [repo::jmjava/agent-automation-]
- F2 Write harness/spend.ts spend locks ported from dogfood-api agent-day with cancel-on-cap #pool #foundation [repo::jmjava/agent-automation-]
- F3 Write harness/board.ts obsidian-mcp stdio client for list, claim, complete, block, and daily note #pool #foundation [repo::jmjava/agent-automation-]
- F4 Write harness/gate.ts verify runner with repeated-error hash and Files allowlist diff check #pool #foundation [repo::jmjava/agent-automation-]
- F5 Write harness/receipt.ts pool-run receipt schema and writer #pool #foundation [repo::jmjava/agent-automation-]
- F6 Write harness/backends/scripted.ts deterministic fake backend for CI #pool #foundation [repo::jmjava/agent-automation-]
- F7 Write harness/backends/cursor-cloud.ts wrapping Agent.create, resume, cancel, and usage #pool #foundation [repo::jmjava/agent-automation-]
- F8 Write harness/backends/cursor-cli.ts wrapping agent -p --output-format stream-json #pool #foundation [repo::jmjava/agent-automation-]
- F9 Write harness/otel.ts mapping SDK stream events to GenAI invoke_agent and execute_tool spans with a console exporter #pool #foundation [repo::jmjava/agent-automation-]
- F10 Add .cursor/rules/pool-contract.mdc and .cursor/hooks.json with a shell deny-list and a stop-hook gate #pool #foundation [repo::jmjava/agent-automation-]
- F11 Add .cursor/environment.json installing Node 22, uv, and obsidian-mcp into .tools #pool #foundation [repo::jmjava/agent-automation-]
- F12 Create fixture repo jmjava/pool-fixture with real CI, one hollow test, and a Files-scoped canvas #pool #foundation [repo::jmjava/pool-fixture]
- F13 Port slm-setup eval cases into harness/cases fixtures #pool #foundation [repo::jmjava/agent-automation-]

## Important Files

- docs/plan.md
- docs/survey.md
- docs/cursor-techniques.md
- docs/existing-assets.md
- vault/AI Memory/Agent Queue.md
- vault/TODO/

## Notes

- Wave order after F1–F13: H1 → H3 → H4 → H2 → H6 → H7 → H5 → H9 → H8. Move the next wave's Agent Queue lines into Next Steps when the current wave is complete, or claim them straight from the queue.
- `#live` tasks spend money; they need `CURSOR_USER_API_KEY` as an environment secret and the spend locks from F2.
- `#manual` tasks need a human in the Cursor dashboard or on the workstation; the agent writes the runbook and stops.
