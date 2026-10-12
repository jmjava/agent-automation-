# agent-automation

Demo harnesses exploring ways to automate **pools of coding agents** on Cursor, reusing the pieces we already own: the Obsidian developer-memory MCP as the task board, SDLC-SPDD as the inner-loop contract, the local-SLM router and apply gate, and the spend-lock recipe from the dogfood runs.

Status: **planning**. Nothing under `harnesses/` exists yet.

| Doc | What it is |
| --- | --- |
| [docs/survey.md](docs/survey.md) | Survey of current techniques (October 2026): harness engineering, isolation, atomic task claims, the five topologies, evidence-based verification, spec-driven development, Git-backed memory, bounded Ralph loops, supervision, durable execution, model routing, interop standards, observability, event-driven loops, and why we are not building a control plane |
| [docs/cursor-techniques.md](docs/cursor-techniques.md) | Dedicated Cursor section: every surface for starting agents (CLI headless, `@cursor/sdk`, Cloud Agents API v1, Automations, Task tool, BDK), isolation and self-hosted pools, policy files and hooks, the Automations event loop and its trigger caveats, spend controls, observability, and what Cursor does not do |
| [docs/existing-assets.md](docs/existing-assets.md) | Inventory of `jmjava` repos and what each contributes; the gaps the plan fills |
| [docs/plan.md](docs/plan.md) | Nine demo harnesses (H1–H9), shared library, rules every harness follows, order, non-goals, open questions |

## The nine harnesses in one table

| # | Harness | Pattern | Proves |
| --- | --- | --- | --- |
| H1 | `queue-pool` | parallel workers from the vault board, cap 7, refill on exit | a Markdown vault is enough board for a cloud pool |
| H2 | `event-loop` | Cursor Automations, one phase per run, gate re-check | unattended loops need no coordinator process |
| H3 | `pipeline-gates` | plan → implement → verify → review with deterministic gates | stage gates catch hollow tests and scope creep |
| H4 | `best-of-n` | tournament, deterministic scorer, premium picker, apply gate | tournaments pay off only under hard gates |
| H5 | `router-tiers` | local SLM → premium review → apply; `gpu` pool routing | delegation is safe when apply is gated |
| H6 | `ralph-bounded` | fresh-context iterations, completion promise, repeat-stop | bounded iteration beats one long context |
| H7 | `patrol` | scheduled watchdog over pool seats, idempotent actions | overnight runs need a watcher that is not a worker |
| H8 | `bdk-coordinator` | hub-and-spoke with a durable BDK hub and `host.kv` | a hub can own a pool across restarts |
| H9 | `self-hosted-pool` | `agent worker start --pool gpu` on your workstation | your hardware is a pool name, not a second platform |

Rules every harness follows (offline-first, spend locks, vault as board, done = all checks `success`, stop on repeated error, one receipt and one trace per pool run) are in [docs/plan.md §0](docs/plan.md#0-rules-for-every-harness).
