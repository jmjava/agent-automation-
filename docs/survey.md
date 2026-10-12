# Survey: techniques for automating pools of coding agents (October 2026)

**Kind:** literature and product survey. Not a benchmark, not an implementation.
**Scope:** how people run *many* coding agents on real repositories, and what keeps that from turning into noise.
**Companion docs:** [Cursor-specific techniques](cursor-techniques.md) · [What we already have](existing-assets.md) · [Demo harness plan](plan.md)

## 1. Vocabulary (three words that get mixed up)

| Term | Meaning | Examples |
| --- | --- | --- |
| **Harness** | The runtime around *one* model session: loop, tools, context, permissions, stop conditions. "What happens when the agent is wrong?" | Claude Code, Codex CLI, Cursor agent, Gemini CLI, OpenHands, Aider |
| **Orchestration** | Coordinating *many* harnessed agents from a center (a human, a script, a lead agent). Assign, isolate, verify, merge. | amux, Gas Town, lindy-orchestrator, ruah, Cursor Automations, your `Uberorchbot` attempt |
| **Choreography** | No center. Agents coordinate through shared state (board, ledger, message bus). | Gas Town patrols, Claude Code agent teams' shared task list, swarm patterns |

The arXiv source-code study of eleven production harnesses ([Harness Engineering, 2609.00006](https://arxiv.org/pdf/2609.00006)) makes a point worth keeping: *a harness is not an orchestrator*. An orchestrator "coordinates one or more harnesses from above and implements no editing loop of its own." Everything in this repo should be an orchestrator or a gate; we never write the editing loop.

The same study names the seven subsystems every harness takes a position on: **agent loop, LLM integration, tools & actions, memory & context, safety & permissions, orchestration, extensibility**, plus two cross-cutting surfaces (interface layer, session substrate). Two empirical absences across ~4M lines: no production harness imports a general-purpose agent framework (LangChain, LangGraph, AutoGen…), and none retrieves code with vector embeddings. The field runs on hand-rolled async loops and deterministic retrieval (ripgrep, tree-sitter, Markdown context files). That matches the Kasana "Harness 2.0" overlay already recorded in `sdlc-spdd-orchestrator`.

## 2. The major trends

Each trend below lists: what it is, who ships it, the failure it addresses, and how it maps to assets we already own.

### T1. Harness engineering: constraints over instructions

**What.** The 2026 consensus is that model quality is not the bottleneck; the environment is. Kasana's loop (`Task → Context → Agent → Tools → Code → Verification → Feedback ↺`) and the arXiv anatomy both say the same thing: turn prose instructions into things that can *fail*. Verify-before-done, show the violated rule, cap repeated failures, diff allowlists, plan-before-write.

**Who.** Every CLI harness; the arXiv study's 18 design recommendations; OpenAI's new Agents SDK split ("harness separate from compute": the trusted runtime owns loop, approvals, secrets, guardrails; the sandbox owns execution).

**Failure addressed.** Agent compiles, passes tests, opens a clean PR, and is still wrong (touched a forbidden file, skipped a test, ignored an architecture decision).

**We already have.** `sdlc-spdd-orchestrator` I1–I3 (verify at code-command exit, `Files:` vs `git diff --name-only`, stop on repeated verify error). `obsidian-mcp` `quality_pool_flow` ("pending is not a pass"; "a failing check still blocks when branch protection does not require it").

### T2. Isolation: worktrees first, VMs when you need processes

**What.** One editable task = one checkout. Git worktrees are the minimum (files only); containers/VMs when tasks need ports, services, credentials, or untrusted execution. Branch-per-agent lands on real CI, so existing branch protection becomes the gate.

**Who.** Claude Code `/worktree`, Cursor `/worktree` + `/best-of-n` + `/apply-worktree`, Codex cloud per-task containers, amux/workmux/Claude Squad (tmux + worktrees), ruah (worktrees plus *file claims*: owned/shared/read-only scopes rejected before agents start), Kubernetes SIG Apps `agent-sandbox` (Sandbox CRD, warm pools, gVisor/Kata via RuntimeClass, pause/resume).

**Failure addressed.** Two agents overwrite each other's files or build output; "it worked in the agent's shell" but not in CI.

**We already have.** Cursor cloud agents (one VM per agent, repo cloned), the `best-of-n-runner` subagent type (isolated worktree per attempt), `tekton-dag` for in-cluster isolation if we ever want K8s.

### T3. Coordination: a task board with atomic claims

**What.** The core primitive is *claim one task in a single operation such that no other agent can claim it*. Then: ready-detection (no open blockers), dependency edges, audit trail, and "compaction" of old closed work so it does not eat context.

**Who.** Beads (`bd ready`, `bd update --claim`, Dolt-backed, hash IDs to avoid merge collisions), amux's SQLite kanban, Gas Town convoys, Cursor SDK's reference "kanban board" sample (drag a card → an agent picks it up → PR → result posted back), Linear/Jira as queue via Automations, DIY Postgres/Redis advisory locks.

**Failure addressed.** Duplicate work, orphaned work, "which of six panes is blocked on an approval?"

**We already have.** `obsidian-mcp` is a Markdown task board with exactly this contract: `list_open_tasks`, `claim_task` / `complete_task` / `block_task` / `unblock_task`, `Agent Queue.md` checkboxes, exclusive file lock outside the vault for concurrent appends, uniqueness check before a claim so a claim cannot succeed while leaving boxes open, secret redaction on write and read. It is the cheapest honest version of Beads: human-readable, Git-diffable, Obsidian-browsable. The gap is cross-machine: it is a local vault, so a pool of cloud agents cannot all mount it (see plan H1 for the bridge).

### T4. Topologies: the five patterns

The amux 2026 guide names five, with ceilings that match what we have seen:

| Pattern | Agents | Quality control | Ceiling |
| --- | --- | --- | --- |
| Solo | 1 | self-review | 1× throughput, context exhaustion |
| **Parallel workers** | 2–50+ | post-hoc review | needs non-overlapping file sets; merge phase bottleneck; no gate between agents |
| **Pipeline** | 3–6 | stage gates (plan → code → test → review) | latency adds up; slow stage blocks all |
| **Hub and spoke** | 1 + 3–10 | coordinator review | coordinator is a single point of failure; its context caps spokes |
| **Swarm** | 5–50+ | peer review / gates | hardest to debug; circular work; needs atomic claims + idempotency + convergence detection |

Everyone shipping a product has landed on *hub and spoke with a human-owned merge*: Claude Code agent teams (lead + teammates with shared task list and direct messaging; experimental, not worktree-isolated), Cursor multi-agent (coordinator managing up to 8), Google Antigravity 2.0 Agent Teams, Gas Town (Mayor + polecats + Witness + Deacon). The "rule of 3": orchestrate only when a task splits into 3+ independent subtasks each worth 15+ minutes of solo agent time.

### T5. Verification: evidence, not vibes

**What.** CI is the real gate, not agent-reported tests. Two new 2026 sub-trends: (a) **hollow-test detection**: mutate the changed function and confirm the test fails (gutcheck's "proven / no binding test / hollow"; adversary-gate's `INCONCLUSIVE` as a first-class outcome rather than silent approval); (b) **independent review agents** that only read (Bugbot, Codex automatic review, Copilot review, Devin review). LLM-as-judge is used for *quality* but never as the merge gate.

**Who.** gutcheck (Stop-hook gate + GitHub Action), adversary-gate (mutation score over the diff, fail-closed), Cursor Bugbot / Security Agents / PR Routing & Approval, Kiro requirements analysis (SMT solvers over EARS requirements before code).

**We already have.** Mutation gates with frozen ceilings (`mutmut`, PIT) in `obsidian-mcp`, `slm-setup`, `orch-guide`; complexity/hotspot/ruff baseline ratchets; the five-technique maintainability list in `quality_pool.py`; `slm-setup` `decide_apply` ("local layer-pass is not approval"; rewrites are re-scored before apply).

### T6. Spec-driven development: the task is a document

**What.** Requirements → design → tasks → code, with the artifacts committed beside the code. Spec Kit (`/speckit.clarify`, `/speckit.analyze`, checklists as "unit tests for English"), Kiro (EARS + property-based tests + formal analysis), OpenSpec (change *deltas* with `sync`/`archive` so shipped work folds back into the living spec; the only one that handles the upward direction well).

**Failure addressed.** Agents jump from a one-line prompt to a patch; nobody can tell later what "done" meant.

**We already have.** SPDD's REASONS canvas, `gate_check` (enter-phase), `Files:` on every operation, `embabel-dif` deterministic fold of a canvas into a checkable projection. This is the part of the stack where we are *ahead* of the market; the plan reuses it rather than adopting Spec Kit.

### T7. Memory: Git-backed, Markdown, agent-edited

**What.** The market moved away from "vector store of past chats" toward versioned files the agent edits with normal tools. Letta Context Repositories / MemFS (Git repo per agent; shared memory repositories across cloud agents; memory subagents in worktrees so learning can be concurrent), Beads (`bd remember` → `bd prime` re-injects; procedural memory, not episodic), AGENTS.md (now a Linux Foundation / AAIF project, 60k+ repos), SKILL.md (leads MCP in harness adoption, 9/11 vs 8/11).

**We already have.** `obsidian-mcp` (Project State / Sessions / Decisions / Daily / TODO as Markdown; `capture_work_session` records branch + SHA; `record_decision` never overwrites), SPDD `lessons.jsonl` stage-then-accept ledger with `retrieve --kind pitfall`, `orch-guide` Neo4j projection for retrieval. Trend-aligned already; the plan only adds *pool-level* memory (who ran, what happened, what to not retry).

### T8. Long-running loops with fresh context: the Ralph loop, bounded

**What.** Instead of one agent fighting context exhaustion, re-run the same prompt in a fresh context each iteration; artifacts persist in files + Git; a completion promise ends it; `--max-iterations` and repeated-error detection prevent runaway. Gas Town made it a first-class dispatch mode (`gt sling --ralph`); Gas City compiles each Ralph step into a control bead plus iteration beads with a check script between attempts.

**Failure addressed.** Context exhaustion; "the agent has been sitting on a question since lunch."

**We already have.** SPDD rule: same verify error twice → `shelf`, never a third automatic retry. `dogfood-api/scripts/agent-day` spend locks (model pinned, `MAX_SENDS`, wall-clock, total tokens; cancel the run when a cap trips).

### T9. Supervision and self-healing

**What.** Watchers that are not the workers. Gas Town's Witness (per-rig: detects stuck polecats, nudges, cleans sessions) and Deacon (cross-rig patrol loop with exponential backoff that sleeps when there is no work and wakes on any mutating command); amux's watchdog (context exhaustion, crashes, stuck prompts) for overnight unattended runs; crystl's "approval cards that find you."

**Failure addressed.** Polling a wall of terminals; agents that silently stall for hours.

**We already have.** Nothing that watches a *pool*. `devguard` watches a machine. This is a real gap and plan H7 fills it.

### T10. Durable execution: the run outlives the process

**What.** Checkpoints are not durability. LangGraph checkpoints state but a dead process kills the run; something must detect, decide where to re-enter, and restart. Temporal's LangGraph plugin (each node an Activity, `interrupt()` becomes a durable wait that costs nothing for days), Restate (journal replay, keyed agent sessions, sub-agents as separate durable invocations), Inngest (step memoization), DBOS (Postgres-backed), AWS Lambda Durable Functions, Azure Durable Task.

**Failure addressed.** A pool coordinator that dies mid-dispatch and double-launches on restart.

**We already have.** BDK's `ctx.host.kv` guidance is the small version of this: no CAS, so make every write idempotent; store `exp` on values; assume the process is replaced between events. Cursor cloud agents themselves are durable (`Agent.resume("bc-…")`), so the *workers* are already durable; only the *coordinator* needs the discipline.

### T11. Model routing and cost tiers

**What.** Cheap/fast model for mechanical work, premium for planning and review; local SLMs for bounded tasks; escalation on verifier failure. The cheapest 5-agent fleets quoted in 2026 run on flat-rate plans plus aggressive routing.

**We already have.** `slm-setup`: route → local fast → repair → local strong → premium review → apply gate, with scripted workers for offline tests; `embabel-slm` as the local model; `dogfood-api` pins `composer-2.5` and refuses Fast mode. Trend-aligned; plan H5 wires it to real Cursor runs and to a self-hosted GPU pool.

### T12. Interop standards: MCP + A2A + AGENTS.md + Skills, under one foundation

**What.** As of October 2026, MCP (tools), AGENTS.md (repo guidance), A2A (agent-to-agent discovery/delegation; ACP merged into it), goose, and Agent Skills sit under the Linux Foundation's Agentic AI Foundation. MCP is vertical (deepens one agent); A2A is horizontal (crosses team/vendor boundaries). ACP additionally became a way to *host* one harness inside another (OpenHands running Claude Code / Codex / Gemini CLI as backends; Devin Desktop runs ACP agents natively).

**Implication for us.** Our coordination surface should be MCP (we already own an MCP server); A2A matters only if a pool needs to delegate to agents we do not run. Do not build a protocol.

### T13. Observability and evals as CI

**What.** OpenTelemetry GenAI semantic conventions now define `invoke_agent`, `invoke_workflow`, `execute_tool`, memory operations, and `gen_ai.evaluation.*` attributes, so a pool run can be one `invoke_workflow` trace with nested `invoke_agent` spans. Reference repos wire OTel + an eval harness + a committed `evals/baseline.json` so a regression fails the build. SWE-bench traces are being published *as* OTel spans.

**We already have.** BDK `defineOtel` and `evals/**/*.eval.ts`; `slm-setup` fixture corpus with pass@1 / pass@end / escalation metrics; `documentation-generator` for turning a run into a narrated demo video. Plan: every harness emits one trace and one JSON receipt; the receipt is what the eval compares.

### T14. Event-driven unattended loops

**What.** The loop is not a Python `while True`; it is an event source firing a configured agent. Cursor Automations (cron, PR/push, label, issue comment, review submitted, CI completed, workflow run completed, Slack, Linear, webhook), Claude Code GitHub Action (`@claude`), Copilot cloud agent (issue → PR), Codex via GitHub/Slack/Linear mentions, Devin via Slack/Linear/Jira. The 2026 caveat we hit in the forums: some triggers are deliberately narrow for permission reasons (Cursor's *workflow run completed* fires only for push-started runs).

**We already have.** SPDD U4 ("separate event-triggered Automations; re-check gate every run; shelf after repeat failure") is designed and *not started*. Plan H2 is U4.

### T15. Platform-grade control planes (the thing we tried and archived)

**What.** Gas City "packs" (declarative agent topologies deployed to a supervisor plane with hundreds of concurrent workers), Omnigent as meta-harness orchestrating eleven vendor harnesses behind one API, Agentastic's control plane across providers/containers/remote hosts, Factory-style "dark factory" pitches.

**Why we are not doing this.** `Uberorchbot`'s Spring control plane + dashboard + worktrees was archived for the same reason the SPDD notes give: it duplicated the host runtime. Cursor already provides the VM farm, the queue, the durable agent record, worker pools, and a dashboard. The trend we *do* follow is the one the arXiv paper calls the "platform turn": harnesses became SDKs, so the orchestrator is a thin program over an SDK, not a farm.

## 3. Anti-patterns the literature agrees on

- Premature orchestration (five agents for a ten-minute task).
- Over-splitting (each agent sees a sliver and produces code that does not integrate).
- No review-bottleneck planning (ten PRs overnight, three reviewable in the morning; stale branches breed conflicts).
- Tightly coupled codebases (every feature touches the same five files; refactor coupling first).
- Ignoring coordination cost: throughput flattens above ~7–10 agents unless the codebase is modular. (`quality_pool.py`'s cap of 7 is already on the right side of this.)
- Building your own agent farm when the vendor runs one.
- Treating "pending" or "LLM says fine" as a pass.

## 4. Sources

Harness anatomy and discipline
- [Harness Engineering: Anatomy, Architecture, and Evolution of Coding Agents (arXiv 2609.00006)](https://arxiv.org/pdf/2609.00006)
- Kasana, *How to Build an AI Agent Harness 2.0* — summarized in `sdlc-spdd-orchestrator/docs/research/kasana-agent-harness-2-0.md`
- [OpenAI: migrate from the Claude Agent SDK to the OpenAI Agents SDK](https://developers.openai.com/cookbook/examples/agents_sdk/migrate-from-claude-agent-sdk/readme.md) (harness/compute split)

Orchestration patterns and tools
- [amux: AI Agent Orchestration in 2026](https://amux.io/guides/ai-agent-orchestration-2026/) · [amux repo](https://github.com/andyrewlee/amux)
- [Agentastic: agent orchestration for software development](https://www.agentastic.dev/agent-orchestration)
- [ruah](https://github.com/levi-tc/ruah) (file claims) · [lindy-orchestrator](https://github.com/eddieran/lindy-orchestrator) (planner/generator/evaluator DAG)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [Welcome to Gas Town](https://yegge.ai/essays/welcome-to-gas-town/) · [Gas Town repo](https://github.com/steveyegge/gastown) · [Welcome to Gas City](https://yegge.ai/essays/welcome-to-gas-city/) · [Ralphcat issue](https://github.com/gastownhall/gastown/issues/1732)
- [Beads](https://github.com/gastownhall/beads) · [Beads profile in memory-layers study](https://github.com/lossless-group/study-memory-layers-for-agents/blob/main/context-v/profiles/Profile__Beads.md)

Verification and specs
- [gutcheck](https://github.com/beepometer/gutcheck) · [adversary-gate](https://github.com/Sanflow10/adversary-gate)
- [GitHub spec-kit](https://github.com/github/spec-kit/) · [Kiro requirements analysis](https://kiro.dev/blog/deep-spec-analysis/) · [Spec-driven development guide (Nimbalyst)](https://nimbalyst.com/blog/spec-driven-development-with-coding-agents/)

Memory and standards
- [Letta Context Repositories](https://www.letta.com/blog/context-repositories/) · [Letta shared memory](https://docs.letta.com/concepts/shared-memory/) · [MemFS](https://docs.letta.com/concepts/memfs/index.md)
- [A2A protocol](https://a2a-protocol.org/latest/) · [A2A and MCP](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/topics/a2a-and-mcp.md) · [A2A joins AAIF](https://aaif.io/blog/a2a-joins-aaif) · [Linux Foundation AAIF announcement](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)

Durable execution and infrastructure
- [Temporal LangGraph plugin](https://temporal.io/blog/temporal-langgraph-plugin-durable-execution) · [restatedev/agent](https://github.com/restatedev/agent) · [Durable execution for agent runtimes (Zylos)](https://zylos.ai/research/2026-04-24-durable-execution-agent-runtimes/)
- [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) · [Running agents on Kubernetes with Agent Sandbox](https://v1-36.docs.kubernetes.io/blog/2026/03/20/running-agents-on-kubernetes-with-agent-sandbox/)

Observability and evals
- [OTel GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md) · [OTel GenAI attributes](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/registry/attributes/gen-ai.md)
- [agent-eval-starter](https://github.com/uxdw/agent-eval-starter) · [SWE-bench traces as OTel spans](https://huggingface.co/datasets/experiential-labs/wmh-swe-bench-traces)

Background / cloud agent landscape
- [AgentAtlas: cloud coding agents compared](https://agentatlas.dev/cloud-agents) · [daily.dev comparison](https://daily.dev/blog/best-ai-coding-agents-comparison/) · [Context Studios guide](https://www.contextstudios.ai/guides/best-ai-coding-agents-2026)

Cursor-specific sources are listed in [cursor-techniques.md](cursor-techniques.md).
