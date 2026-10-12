---
status: open
project: agent-automation
kind: epic
wave: 1
---

# F foundation: shared harness library

Everything under `harness/` that the nine demos share. Nothing here calls a model in CI.

## Owns these Agent Queue lines

F1 through F13 in `AI Memory/Agent Queue.md`. Claim one line per session.

## Spec

| Task | Files | Done when |
| --- | --- | --- |
| F1 scaffold | `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.github/workflows/tests.yml` | `npm test` runs an empty suite green in CI on Node 22; `@cursor/sdk` installs |
| F2 `spend.ts` | `harness/spend.ts`, `harness/spend.test.ts` | Config: `model`, `maxSends`, `runTimeoutMs`, `maxTotalTokens`, `wallMs`. `guard(run)` cancels via `run.cancel()` when `run.usage` or elapsed exceeds a cap and returns the tripped lock name. Port the semantics from `dogfood-api/scripts/agent-day/run-cursor-day.mjs` |
| F3 `board.ts` | `harness/board.ts`, `harness/board.test.ts` | Spawns `obsidian-mcp` over stdio (MCP SDK client), exposes `listOpen(project)`, `claim(project, text)`, `complete`, `block`, `unblock`, `appendDaily(heading, text)`. Test against a temp vault; never the real one |
| F4 `gate.ts` | `harness/gate.ts`, `harness/gate.test.ts` | `runVerify(commands)` returns outputs; `errorHash(output)` is stable across timestamps; `repeatStop(history)` is true after two identical hashes; `filesAllowlist(diffPaths, files, testGlobs)` reports violations |
| F5 `receipt.ts` | `harness/receipt.ts`, `harness/receipt.schema.json` | Schema: pool id, harness, started/finished, cap, seats[] {task, agentId, model, status, pr, checks, tokens, trippedLock, blockedReason}, summary counts. Writer is atomic |
| F6 `backends/scripted.ts` | `harness/backends/scripted.ts` | Same interface as cursor-cloud; replays a queue of canned events, PR urls, and check states; records every call |
| F7 `backends/cursor-cloud.ts` | `harness/backends/cursor-cloud.ts` | `create({repo, ref, prompt, model, metadata, envVars})`, `resume(id)`, `cancel(runId)`, `usage(run)`; reads `CURSOR_USER_API_KEY`, refuses `sk-proj` keys with a clear error |
| F8 `backends/cursor-cli.ts` | `harness/backends/cursor-cli.ts` | Wraps `agent -p --output-format stream-json`; parses NDJSON; exposes the same interface for in-VM runs |
| F9 `otel.ts` | `harness/otel.ts` | Maps stream events to `invoke_workflow` → `invoke_agent` → `execute_tool` spans with `gen_ai.*` attributes; console exporter default; OTLP if `OTEL_EXPORTER_OTLP_ENDPOINT` is set |
| F10 rules + hooks | `.cursor/rules/pool-contract.mdc`, `.cursor/hooks.json`, `scripts/hooks/*.sh` | Rule is `alwaysApply: true`; deny-list blocks `git push --force`, edits under `.github/workflows`, `rm -rf` outside the repo; `stop` hook runs `gate.ts` and refuses "done" when verify fails |
| F11 environment | `.cursor/environment.json`, `.cursor/install.sh` | Cloud agent boots with Node 22, uv, and `obsidian-mcp` cloned to `.tools/`; `npm test` passes in the VM |
| F12 fixture repo | new repo `jmjava/pool-fixture` | Small Node or Python app with real CI, one deliberately hollow test, a REASONS canvas with `Files:` on each operation, and three independent small tasks for H1 |
| F13 cases | `harness/cases/*.json` | Port `slm-setup` `cases.py`, `cases_extended.py`, `cases_harder.py` fixtures with expected layer outcomes |

## Agent protocol

1. `get_project_context("agent-automation")`, then read `docs/plan.md` §0 and §1 in the repo.
2. `claim_task("agent-automation", "<full queue line>")`.
3. Touch only the files in the row above plus tests. Run `npm test` and lint; commit only on exit 0.
4. Open a PR; read `gh pr checks` until the run finishes; pending is not a pass.
5. `capture_work_session(...)` with `repository_path`; `complete_task` only when every check is success. Otherwise `block_task` with the reason.
