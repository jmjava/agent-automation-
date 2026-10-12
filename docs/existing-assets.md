# What we already have

Inventory of `jmjava` repositories that a pool harness can reuse, read on 2026-10-12 from public `main`. One repository the task referred to could not be read (see the last section).

| Repo | What it is | Reusable for pools |
| --- | --- | --- |
| **`obsidian-mcp`** | Stdio MCP server; Markdown vault as engineering memory | The **task board**: `Agent Queue.md` checkboxes + Project State Next Steps / In Progress / Blocked / Completed; `list_open_tasks`, `list_blocked_tasks`, `claim_task`, `complete_task`, `block_task`, `unblock_task` with an exclusive lock outside the vault and uniqueness checks; `quality_pool_flow` (cap 7, refill on exit, selection order, "pending is not a pass", stop list); `capture_work_session` records branch/SHA/dirty state; secret redaction on write and read; path-traversal guard; mutation + ruff + hotspot + complexity gates in CI |
| **`sdlc-spdd-orchestrator`** | Repository-native SDLC process model (REASONS canvas, phases, `gate_check`, `lessons.jsonl` ledger, adapters for Cursor/Copilot/Claude) | The **inner loop contract** (Kasana I1: verify at exit, show the violated rule, stop after the same error twice, `Files:` vs `git diff --name-only`); U0–U5 vision for running phases as Cloud Agents (U4 "separate event-triggered Automations" not started); `sdlc.sh next \| gate \| start \| capture \| shelf`; `.cursor/environment.json` + `install.sh` so a cloud agent boots SPDD-ready; demo pipeline under `docs/demos/` |
| **`slm-setup`** | Spec + stdio MCP bridge routing bounded code generation to a local Ollama host | The **routing and apply gate**: `route()` keep/delegate, `next_plan` fast → repair → strong, `decide_apply` (local pass is not approval; rewrites re-scored; `INCONCLUSIVE`-style `blocked` reasons), `ScriptedLocal` / `ScriptedReviewer` so the harness is testable with no model; receipts; a cloud-agent run already recorded as a dated results note |
| **`dogfood-api`** | Playable consumer for the DIF + orchestrator ecosystem | `scripts/agent-day/run-cursor-day.mjs`: the only existing code here that **spawns a real Cursor agent from `@cursor/sdk`**, with spend locks (model pinned to `composer-2.5`, 2 sends, 8-minute run, 150k tokens, 12-minute wall), `guard-no-secret-leak.sh`, a `status.sh` verdict that fails a JUnit test when the day failed, and the lesson that the VM-injected `CURSOR_API_KEY` is the wrong key type |
| **`embabel-dif`** | Deterministic Intent Folding beside Embabel's planner | Canvas → `.gate.json` fold; a checkable projection of intent; the "verifier is the acceptance boundary" framing |
| **`orch-guide`** (fork of `embabel/guide`) | Chat + MCP server over Embabel docs with SPDD projection into Neo4j | Retrieval for agents (`spdd_*` MCP tools); fork-only posture enforced by CI; cloud-agent env notes |
| **`uber-lang-of-compute`** | KBL compute fabric: CRDs + controller, dominos, multiverse via Kafka | The Kubernetes-controller habit if a pool ever needs a real control plane; otherwise out of scope |
| **`tekton-dag`** | Standalone Tekton pipelines with an in-cluster orchestrator service, HMAC webhooks, promote pipeline | Webhook → run patterns; could be an *event source* for a Cursor automation; not an agent runtime |
| **`documentation-generator`**, **`demo-creator`** | Narrated demo videos (Manim/VHS) and real-GUI recordings | Turning each harness run into a demo artifact |
| **`devguard`** | Read-only Ubuntu diagnostics including local SLM metrics | Health signal for a self-hosted worker machine |
| **`embabel-slm`** | Local coding model for Embabel/Spring/Kotlin | The model behind a `gpu` pool worker |
| **BDK** (`@cursor/bdk`, available in this environment's skills) | Long-lived agent framework: channels, schedules, subagents, hooks, `host.kv`, root `evals/` | The **coordinator** shape; durable key-value memory; evals as CI |

## Reading of the "orchestration repo attempting a harness"

The SPDD research notes describe `jmjava/Uberorchbot`: a Spring control plane, dashboard, and local worktrees (archived to `archive/main-lab-control-plane` on 2026-08-02), with `main` reduced to a Cursor plugin (`jmjava-lab-automations`: `cloud-agent-contract`, `pr-quality-bar` rules, finder skills, an `sdlc-session` skill). The documented conclusion was: do not revive the control plane; Cursor Cloud Agents + Environments are the platform; Automations are the loop; the plugin shapes behavior after a run starts.

That repository returned 404 for this agent's GitHub token (repo-scoped; private repos are not visible), so the reading above is second-hand from `sdlc-spdd-orchestrator/docs/research/uberorchbot-via-sdlc-spdd.md`. If the repository you meant is a different one, add it as a `repositoryDependencies` entry or grant access and the inventory can be corrected. The plan below does not depend on reading it: the archived control plane is exactly the shape the survey says not to rebuild, and the plugin pieces (rules, skills) are already the shape every harness here installs.

## What is genuinely missing (gaps the plan fills)

1. **A bridge from the local vault to a pool of cloud agents.** The vault is a filesystem; cloud VMs cannot mount it. Options: expose `obsidian-mcp` over HTTP for the duration of a run, sync the vault directory as a Git repo the agents clone, or have the *coordinator* hold the only vault handle and pass each agent its claimed task as prompt text.
2. **A coordinator that is not a human.** Every existing piece either runs inside one agent or waits for a person to start the next phase.
3. **A pool watchdog.** Nothing lists seats, detects stalls, nudges, or shelves.
4. **Receipts and evals at pool level.** `slm-setup` has per-job receipts; nothing records "this pool run launched 5, 4 merged, 1 shelved after repeated verify failure."
5. **Live U4.** Event-triggered automations with gate re-check are specified and unbuilt.
