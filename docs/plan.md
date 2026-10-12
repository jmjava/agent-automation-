# Plan: demo harnesses for automating pools of agents

**Kind:** implementation plan for this repository. Nothing below is built yet.
**Inputs:** [Survey](survey.md) (trends T1–T15) · [Cursor techniques](cursor-techniques.md) · [Existing assets](existing-assets.md)

## 0. Rules for every harness

These come straight from the survey's consensus and from what we already learned in `sdlc-spdd-orchestrator`, `slm-setup`, and `dogfood-api`.

1. **We write orchestrators and gates, never an editing loop.** The agent is Cursor (SDK/API/Automation). No `class AgentHarness` that calls a model.
2. **Every harness runs offline first.** A `--backend scripted` mode substitutes a scripted worker (the `ScriptedLocal` / `ScriptedReviewer` idea from `slm-setup`) so the dispatch, claim, gate, and receipt logic is unit-tested in CI with zero spend. Live mode is opt-in and needs `CURSOR_USER_API_KEY`.
3. **Spend locks are not optional.** Port `dogfood-api`'s recipe into a shared module: pinned model, max sends, per-run timeout, total-token cap read from `run.usage`, wall budget, `run.cancel()` when a cap trips, secret-leak guard on tracked files.
4. **The vault is the board; the coordinator holds the only handle.** Cloud agents never mount the Obsidian vault. The coordinator calls `obsidian-mcp` (`claim_task` → prompt text → `complete_task` / `block_task`) and writes one `append_daily_note` per pool run. This keeps the board human-readable and avoids inventing a service.
5. **Done means every check in that run is `success`.** Pending is not a pass; a failing check blocks even when branch protection does not require it (`quality_pool_flow`). A green PR GitHub rejects because the token cannot edit `.github/workflows` is the only acceptable open outcome.
6. **Stop on repeat.** Same verify error twice (hash of the failing command output) → shelf, write the pitfall, do not launch a third attempt.
7. **One JSON receipt per pool run, one OTel trace per pool run.** The receipt is what evals compare against a committed baseline. The trace is `invoke_workflow` → `invoke_agent` per seat → `execute_tool` as available from SDK stream events.
8. **Cap 7.** Pool size defaults to `QUALITY_POOL_CAP` and refills when a seat exits. Raising it is a config change with a reason in the receipt.
9. **Rule of 3.** A harness refuses to fan out when the task list has fewer than three independent items and says so in the receipt.

## 1. Repository layout

```
agent-automation-/
├── README.md
├── docs/                      survey, cursor-techniques, existing-assets, plan (this file)
├── harness/                   shared TypeScript library (Node 22, @cursor/sdk)
│   ├── spend.ts               spend locks + cancel-on-cap (from dogfood-api)
│   ├── board.ts               obsidian-mcp client: list/claim/complete/block + daily note
│   ├── gate.ts                verify runner, repeated-error hash, Files: allowlist diff check
│   ├── receipt.ts             pool-run receipt schema + writer
│   ├── otel.ts                SDK stream events → GenAI spans (console exporter by default)
│   ├── backends/
│   │   ├── cursor-cloud.ts    Agent.create({cloud}) / resume / cancel
│   │   ├── cursor-local.ts    Agent.create({local}) for in-VM runs
│   │   ├── cursor-cli.ts      `agent -p --output-format stream-json` wrapper
│   │   └── scripted.ts        deterministic fake for CI
│   └── cases/                 fixture repos + task lists used by every harness
├── harnesses/
│   ├── h1-queue-pool/
│   ├── h2-event-loop/
│   ├── h3-pipeline-gates/
│   ├── h4-best-of-n/
│   ├── h5-router-tiers/
│   ├── h6-ralph-bounded/
│   ├── h7-patrol/
│   ├── h8-bdk-coordinator/
│   └── h9-self-hosted-pool/
├── evals/                     receipt baselines; a regression fails CI
├── .cursor/
│   ├── rules/pool-contract.mdc   alwaysApply: never edit .github/workflows, no force-push, receipts required
│   ├── hooks.json                beforeShellExecution deny-list; stop hook runs gate.ts
│   └── environment.json          install: node 22 + uv + clone obsidian-mcp into .tools/
└── .github/workflows/
    ├── tests.yml                 unit + scripted-backend runs of every harness
    └── ratchets.yml              same maintainability gates the other repos use
```

Each `harnesses/hN-*/` holds `README.md` (what it demonstrates, which trends, how to run offline and live), `run.ts`, a `cases.json`, and `evals/*.eval.ts`.

## 2. The harnesses

Ordered by value divided by risk. H1 and H3 are the foundation; everything else composes them.

### H1 `queue-pool`: parallel workers from the vault board
*Trends: T2 isolation, T3 atomic claims, T4 parallel workers, T11 model pinning, T13 receipts.*

**Demonstrates.** The `quality_pool_flow` contract running for real: a coordinator reads `list_open_tasks`, applies the selection order, claims up to `cap` tasks, launches one cloud agent per task (`autoCreatePR: true`, `cloud.metadata: { pool, seat, task }`), waits for each run, reads `gh pr checks` until the run finishes, then `complete_task` or `block_task`. When a seat exits, the next open task refills it.

**Mechanics.** `harness/board.ts` talks to `obsidian-mcp` over stdio (the coordinator is the only process with `OBSIDIAN_VAULT_PATH`). Tasks carry `[repo::owner/name]` so one pool can span repos. Prompt = task text + the `pool-contract.mdc` text + the Kasana four bullets.

**Gate.** PR checks all `success`; `Files:` allowlist honored if the task names one.

**Offline mode.** Scripted backend returns canned PR URLs and check states; the test asserts refill order, cap, uniqueness failure handling (ambiguous claim leaves the board untouched), and that a `pending` check never completes a task.

**Done when.** Scripted run passes in CI; one live run against a throwaway fixture repo produces a receipt and a daily-note entry; the receipt is committed as the first eval baseline.

### H2 `event-loop`: Automations as the unattended loop (SPDD U4, live)
*Trends: T14 event-driven, T1 constraints, T5 CI as the gate.*

**Demonstrates.** No coordinator process at all. Three automations on a fixture repo: (a) *issue label `ready` added* → agent claims the Work ID, runs `sdlc.sh gate code`, implements one T##, opens a PR; (b) *CI completed on PR* with failure → agent reads the log and either fixes once or comments `shelf` and adds the `shelved` label; (c) *PR label `shelved` added* → agent writes the pitfall to the ledger and stops. Each run re-checks the gate; nothing self-chains.

**Mechanics.** This repo stores the three prompts as files (`harnesses/h2-event-loop/prompts/*.md`) and a `webhook-post.ts` for triggering from outside (used by H1 later). `.cursor/hooks.json` `stop` hook runs the gate so "done" is verified in the VM before the PR opens.

**Caveats to encode.** Use *CI completed*, not *workflow run completed* (push-only). Filter by workflow file name.

**Offline mode.** Prompt files are linted for the required four bullets; a replay test feeds recorded GitHub payloads to the hook script.

**Done when.** The three automations exist in the dashboard (manual step documented in the README), one labeled issue produces a PR, one forced CI failure produces a single fix attempt and then a shelf.

### H3 `pipeline-gates`: plan → implement → verify → review with deterministic gates
*Trends: T1, T4 pipeline, T5 hollow-test detection, T6 spec as task.*

**Demonstrates.** One agent, several runs, a gate between each stage. Stage 1 (`plan`) produces the canvas operation with `Files:` and validation commands; `gate.ts` refuses to proceed if `Files:` is missing. Stage 2 (`implement`) edits; gate = `git diff --name-only ⊆ Files: ∪ tests`, validation commands exit 0. Stage 3 (`verify`) is deterministic, not an agent: run the suite, then the mutation probe on changed functions (gutcheck-style: swap the return value, confirm the test fails, flag hollow tests). Stage 4 (`review`) is a *read-only* agent run (or Bugbot) that may only output `approve | changes`. Repeat-stop applies at every stage.

**Mechanics.** `agent.send()` per stage on the same cloud agent (keeps workspace); or `customSubagents` with distinct instructions. Gate outputs are appended to the prompt of the next stage verbatim ("show the failing rule").

**Offline mode.** Fixtures from `slm-setup/eval/cases*.py` ported to `harness/cases/`: a hollow-test fixture must be caught; a `Files:` violation must be caught.

**Done when.** Scripted pipeline passes all fixture expectations; a live run on the fixture repo yields a PR whose receipt shows four gates with evidence.

### H4 `best-of-n`: tournament with a deterministic scorer and a premium picker
*Trends: T2 worktrees per attempt, T5 evidence, T11 tiers.*

**Demonstrates.** The same task to N seats with different models/params (e.g. `composer-2.5`, one thinking model, one fast model). A deterministic scorer ranks candidates: tests pass (hard), `Files:` honored (hard), mutation probe (soft), diff size (soft), token cost (soft). Only then does a premium reviewer choose among top candidates, and `decide_apply` from `slm-setup` governs whether anything is applied: a reviewer "accept" of an unproven candidate is `blocked:accept_unproven`.

**Mechanics.** Cloud: N `Agent.create({cloud})` on the same `startingRef`, `autoCreatePR: false`, collect diffs via the run's git metadata. Local: the `best-of-n-runner` subagent or CLI `--worktree` for an in-IDE variant.

**Offline mode.** Scripted candidates with known layer outcomes; assert the picker never applies a candidate that failed a hard gate.

**Done when.** Receipt shows per-candidate scores, the pick, and cost; eval asserts the pick is stable for the fixture.

### H5 `router-tiers`: local SLM → premium → self-hosted pool
*Trends: T11 routing, T1 apply gate, T12 MCP as the surface.*

**Demonstrates.** `slm-setup`'s router with real executors. `route()` decides keep/delegate from task signals; delegated mechanical tasks go to the local `local_coding_slm` MCP (fast → repair → strong); the result is scored; a premium Cursor run reviews and may rewrite; `decide_apply` gates. Tasks flagged `needs-gpu` are sent to a self-hosted pool (`env: { type: "pool", name: "gpu" }`), see H9.

**Offline mode.** `slm-setup`'s `stub_ollama` plus scripted reviewer; the existing `run_orchestration.py` metrics (delegated, applied, held) become the receipt.

**Done when.** The closed-loop table from `slm-setup/docs/cloud-orchestrator-results-2026-09-07.md` is reproduced with a *real* premium reviewer run instead of a self-assessment.

### H6 `ralph-bounded`: fresh-context iterations with a completion promise
*Trends: T8 Ralph loop, T1 repeat-stop, T10 resumable workers.*

**Demonstrates.** A phased prompt with acceptance criteria; each iteration is a new `agent.send()` (fresh context) or a new agent on the same branch; artifacts persist in Git; the loop ends when the completion promise string appears *and* the gate passes; `--max-iterations` and the repeated-error hash stop runaway loops. Progress is written to the vault session note after every iteration so a crashed coordinator can `Agent.resume()` and continue from the last recorded iteration.

**Offline mode.** Scripted iterations that converge at iteration 3; a variant that repeats the same error twice must stop at 2.

**Done when.** Live run completes a multi-step fixture task in ≤ N iterations with a receipt per iteration.

### H7 `patrol`: the pool watchdog
*Trends: T9 supervision, T13 observability, T10 idempotent coordinator.*

**Demonstrates.** A scheduled job (Cursor Automation on cron, "no repository" mode, or a BDK schedule) that lists agents tagged `pool=*` via `GET /v1/agents`, classifies each seat (running within budget, running past budget, finished without PR, `ERROR`, `EXPIRED`, PR with failing checks, PR green but unmerged for > X hours), then acts: nudge via a follow-up run with a fixed message, cancel past-budget runs, mark the task blocked in the vault, or do nothing. Exponential backoff when there is no work. Every action is idempotent and recorded in `host.kv`/receipt so a re-run does not nudge twice.

**Offline mode.** Fixture agent lists in each state; assert the action table.

**Done when.** The patrol runs on a schedule for a day over H1's seats and its daily-note summary matches the receipts.

### H8 `bdk-coordinator`: hub-and-spoke with a durable coordinator
*Trends: T4 hub and spoke, T10 durable coordinator, T14 channels, T13 evals.*

**Demonstrates.** A BDK agent (`bot/agent.ts`) as the long-lived hub: Slack `/pool run <project>` or a GitHub issue label fires it; it uses H1's board logic and H3's gates as *server tools*, holds pool state in `ctx.host.kv` (prefixed by pool run id, with `exp`), spawns spokes through the Cloud Agents API, and posts a results table back to the channel. `turn.completed` hook triggers the follow-up actions rather than acting inside a tool. Root `evals/` replays recorded channel events.

**Offline mode.** BDK `run` / `eval` against recorded fixtures; scripted backend for spokes.

**Done when.** `bdk validate` passes; one Slack-triggered pool run completes end to end; evals pass in CI.

### H9 `self-hosted-pool`: a named GPU pool on your own machine
*Trends: T2 isolation choice, T11 local models, T15 "do not build a farm".*

**Demonstrates.** `agent worker start --pool gpu --worker-dir ~/pool --on-session-start ./prepare.sh` on the Ollama workstation; H5 routes `needs-gpu` tasks there via `env.type: pool`. Shows the environment-settings mapping (hooks instead of `environment.json`, rules in `--worker-dir`), Secret sync, and `devguard` as the worker health signal. A tiny controller stub on the Cloud Agents API shows the "watch queue → claim → start worker" shape without implementing autoscaling.

**Offline mode.** None meaningful; this harness is documentation plus the controller stub's unit tests.

**Done when.** One task routed to `gpu` runs on the workstation and its receipt records the pool name and worker id.

## 3. Order and dependencies

```
foundation:   harness/ (spend, board, gate, receipt, otel, scripted backend)
     │
     ├── H1 queue-pool ───────┬── H7 patrol (watches H1 seats)
     │                        └── H8 bdk-coordinator (H1 logic as tools)
     ├── H3 pipeline-gates ───┬── H4 best-of-n (reuses scorer + decide_apply)
     │                        └── H6 ralph-bounded (reuses gate + repeat-stop)
     ├── H2 event-loop (independent; needs dashboard setup)
     └── H5 router-tiers ──── H9 self-hosted-pool
```

Suggested sequence: foundation → H1 → H3 → H4 → H2 → H6 → H7 → H5 → H9 → H8. H8 last because it is the only one that adds a new runtime (BDK) and it benefits from every gate already existing as a function.

## 4. What each harness proves, in one line each

| Harness | Proves |
| --- | --- |
| H1 | A Markdown vault is a sufficient task board for a 7-seat cloud pool |
| H2 | Unattended loops need no coordinator process if each run re-checks its gate |
| H3 | Stage gates between runs catch hollow tests and scope creep that CI alone misses |
| H4 | Tournaments only pay off when the picker is bound by deterministic hard gates |
| H5 | Local SLM delegation is safe when apply is gated by premium review and re-scoring |
| H6 | Fresh-context iteration beats one long context, if bounded by promise + repeat-stop |
| H7 | A watchdog that is not a worker turns "overnight" from hope into a schedule |
| H8 | A durable hub with kv memory can own a pool across process restarts |
| H9 | Routing to your own hardware is a pool name, not a second platform |

## 5. Non-goals

- A dashboard, a database, or a Kubernetes control plane for agents (archived `Uberorchbot` shape; Gas City scale is not our problem).
- A first-party agent loop or a Python `AgentHarness` class.
- Replacing SPDD's canvas with Spec Kit, or the vault with Beads. Either can be *added* behind `board.ts` later.
- Any PR against `embabel/guide`.
- Claiming reduced drift or research novelty; these are demos with receipts.

## 6. Open questions to settle during the foundation step

1. **Key handling:** user API key vs service-account key for the coordinator; where it lives when the coordinator itself runs as a cloud agent (environment secret, new agent after adding it).
2. **Vault reachability for H7/H8** when the coordinator is not on the vault machine: Git-synced vault clone vs vault only touched by a local patrol. Default: the vault is only written by processes on the machine that owns it; cloud coordinators write receipts to the repo and a local patrol folds them into the vault.
3. **Fixture repo:** create a small throwaway repo (`jmjava/pool-fixture`) with real CI, a deliberately hollow test, and a `Files:`-scoped canvas, so every live demo is cheap and repeatable.
4. **The private orchestration repo:** if it is not `Uberorchbot`, which repository and which branch should the plan read?
