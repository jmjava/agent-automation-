# Cursor techniques for automating pools of agents

**Kind:** reference. Every surface Cursor exposes that is useful for running many agents, with the caveats we have verified. Dated October 2026; re-check the linked docs before relying on a flag.
**Companion docs:** [Survey](survey.md) · [Existing assets](existing-assets.md) · [Plan](plan.md)

## 1. Ways to start an agent

| Surface | How | Pool-relevant properties |
| --- | --- | --- |
| **IDE agent** | Cursor desktop | Interactive; first place to prove a skill before scheduling it |
| **Cursor CLI, headless** | `agent -p "..." --output-format text\|json\|stream-json [--stream-partial-output]`, auth via `CURSOR_API_KEY` | NDJSON events, one `result` event at the end, session ids stable per execution; `thinking` suppressed in print mode; the loop runs on *your* machine |
| **`@cursor/sdk` (TypeScript, public beta)** | `Agent.create({ local })` or `Agent.create({ cloud: { repos, autoCreatePR } })`; `agent.send(prompt)` returns a `Run` with `stream()` / `wait()` / `cancel()` | Same harness as desktop/CLI/web; cloud runs show up in the Agents window; `Agent.resume("bc-…")` reattaches after your process dies; `run.usage` gives cumulative tokens; `cloud.envVars` per agent *and* per run (run-scoped wins, then reverts); `cloud.metadata` string tags for your own bookkeeping; `agent.reload()` re-reads hooks/MCP/subagents without disposing; Node 22.13+ |
| **Cloud Agents API v1 (REST)** | `POST /v1/agents` (creates the durable agent *and* its first run), `POST /v1/agents/{id}/runs` for follow-ups, `GET /v1/agents`, `GET /v1/agents/{id}`, list runs, `GET /v1/models` for valid model ids and params | Any provider (GitHub, GitLab incl. self-hosted, Bitbucket, Azure DevOps); up to 20 repos; `mcpServers` inline (http or stdio); `customSubagents`; `mode`; webhooks are "coming soon" on v1 (legacy v0 still has them) |
| **Automations** | Dashboard-configured trigger + fixed prompt + repo/environment | Cron; PR opened/push; PR label changed; issue label changed; issue comment; PR review comment; review submitted; review thread resolved; CI completed; workflow run completed; Slack; Linear; private webhook endpoint. "No repository" mode for Slack/MCP/webhook-only jobs |
| **Chat mentions** | `@cursor` on a GitHub PR/issue or Bitbucket PR; Slack integration | Human-in-the-loop entry point to the same cloud runtime |
| **Task tool (inside an agent)** | `subagent_type` local or `environment: "cloud"`; `best-of-n-runner` gives each attempt its own worktree and branch | Hub-and-spoke from *inside* a running agent; cloud subagents get their own VM and branch |
| **BDK (`@cursor/bdk`)** | A long-lived agent with `bot/agent.ts`, channels (Slack, GitHub, HTTP), schedules, subagents, hooks, `ctx.host.kv`, root `evals/` | The right shape for a *coordinator* that must outlive one run; memory must go in `host.kv` because the serve process can be replaced between events |

Terms-of-service note: Cursor staff on the forum confirmed that calling the API/SDK/headless CLI from your own application is the intended use; the August 2026 AUP clause targets reselling Cursor access, not automation.

Key-type note (learned in `dogfood-api`): the `CURSOR_API_KEY` injected into a cloud VM is an internal token and returns 401 from the SDK. Programmatic spawning from inside a cloud agent needs a user API key or a service account key stored as an environment secret, and a *new* agent must be started after adding the secret (VMs only see secrets that existed at boot).

## 2. Parallelism and isolation

- **Cloud agents are unlimited in parallel** and do not need your machine connected. One VM per agent, repo cloned, environment built from `.cursor/environment.json` or a Dockerfile, prebuilt **builds** so the next agent boots warm.
- **Worktrees in the IDE and CLI**: `/worktree` (one isolated run), `/best-of-n` (N attempts, pick one), `/apply-worktree`, `/delete-worktree`; CLI `--worktree`. Worktrees land on real branches, so branch protection + CI is the gate before `/apply-worktree`. A common 2026 convention is an `agent/` or `cursor/` branch prefix with protection rules keyed on it.
- **Multi-repo environments** for tasks that span frontend/backend/infra; the agent opens PRs in each repo it changed. `repositoryDependencies` for a framework plus app.
- **Self-hosted machines and pools**: `agent worker start --pool <name>` opens an outbound HTTPS connection; Cursor runs inference and planning, your worker runs edits and shell. Requests queue in the pool until a worker claims one; each session claims one worker. Named pools for `gpu`, `ios`, etc. **Any-repo pools** (`--clone-git-repos`, implies `--mint-github-token`) accept several repos per request; `default` and repo-bound pools accept one. The API targets these with `env: { type: "pool" | "machine", name }`; an unknown pool name returns 400 instead of queueing forever. If you need custom scheduling, quotas, or placement, the docs say to build a controller on the Cloud Agents API: watch the request queue, claim a request, start a worker.
- **Self-hosted equivalents of environment settings**: install/start → `sessionStart` hook or `--on-session-start`; secrets → the machine or team/user Secret sync (`--sync-dashboard-secrets`); `.cursor/environment.json` → `.cursor/hooks.json` in the worker directory; rules for any-repo pools → an `.mdc` under `.cursor/rules` in `--worker-dir`.

## 3. Policy, memory, and extension surfaces the agent reads

| File / setting | Role in a pool |
| --- | --- |
| `.cursor/rules/*.mdc` (`alwaysApply`) | Per-repo constraints the agent cannot skip; `obsidian-mcp` and `orch-guide` already rely on this (a CI job fails if the rule loses `alwaysApply`) |
| `AGENTS.md` | Cross-vendor repo guidance (AAIF standard); Cursor reads it |
| `.cursor/skills/` or `.agents/skills/` (`SKILL.md`) | On-demand procedures; available on cloud agents and self-hosted workers |
| `.cursor/agents/` | Custom subagents; also injectable per request through the API's `customSubagents` |
| `.cursor/hooks.json` | Deterministic gates. Cloud-supported: `preToolUse`, `postToolUse`, `postToolUseFailure`, `beforeShellExecution`, `afterShellExecution`, `beforeReadFile`, `afterFileEdit`, `beforeSubmitPrompt`, `subagentStart`/`subagentStop`, `preCompact`, `afterAgentResponse`/`afterAgentThought`, `stop`. Hooks start once the agent has a writable environment. User-level `~/.cursor/hooks.json` is *not* available in the cloud; team/enterprise hooks are |
| `.cursor/mcp.json` and API `mcpServers` | Tools; an environment can restrict with `mcpServerAllowlist` |
| `.cursor/environment.json` | `install`, `start`, `terminals`, snapshot permissions, repos; resolved before personal/team saved environments |
| Plugins | Rules + skills + commands as an installable pack (the shape `Uberorchbot` `main` ended up as) |

The `stop` hook is the natural place for a "done-claim" verifier (the gutcheck pattern). `beforeShellExecution` with `matcher` is the place for deny-lists (no `git push --force`, no `rm -rf`, no editing `.github/workflows`).

## 4. The event loop: Automations

- An automation = one or more **triggers** + a fixed **prompt** + a fixed **repo/environment** + a fixed **model**. Nothing is chosen at runtime. Fan-out is "many automations," not "one automation that spawns agents."
- **Trigger caveat verified on the forum:** *Workflow run completed* only fires when the Actions run was started by a **push** (so the triggering human is identifiable). `workflow_dispatch`, schedules, and `pull_request`-only workflows never fire it. Use *CI completed* for PR triage, or make the workflow also run on `push`. Filter by workflow *file name* (`deploy.yml`), not the display `name:`.
- **Webhook triggers** give a private POST endpoint, which is how an external queue (the Obsidian vault bridge, a Linear filter, a Tekton task) can start a Cursor run without the API key living in the external system.
- **Subscriptions** (`cursor-subscriptions` MCP: GitHub PR/CI, Slack thread/channel, Linear issue/comment, timer) let a *running* agent wait for an external event without polling; they continue the same conversation and do not spawn a new phase agent.
- **Follow-up queue**: a human steers an in-flight run without a new lifecycle; the queue is visible to the agent (`get-message-queue`).
- Managed automations already exist for the review tier: **Bugbot**, **Security Agents**, **PR Routing & Approval** (can approve low-risk PRs).

## 5. Spend and safety controls

- Model pinning and params: `model: { id, params: [{ id: "fast", value: "true" }] }`; `GET /v1/models` lists valid combinations. Cheapest standard model today is `composer-2.5` (what `dogfood-api` pins).
- `run.usage` / `result.usage` (cumulative tokens) and a `usage` stream event per turn; `run.cancel()` or `Agent.cancelRun(runId)` when a cap trips. The `dogfood-api` spend-lock recipe (model pinned, `MAX_SENDS`, per-run timeout, total token cap, wall budget, secret-leak guard) ports directly.
- `cloud.envVars` on `agent.send()` for short-lived credentials that must not persist on the agent.
- Local SDK agents run tools **without approval prompts**; gate with hooks or `local.sandboxOptions.enabled: true`.
- Branch naming and protection remain the merge gate; agents cannot edit `.github/workflows` with the default token (a known "green but un-mergeable" outcome that `quality_pool.py` already names).

## 6. Observability

- Every SDK/API cloud run appears in the Agents window and web app with its transcript, diff, and PR; `cursor-cloud` MCP tools (`list-cloud-agents`, `batch-fetch-details`, `get-events`) expose the same from inside an agent.
- `GET /v1/agents` and list-runs are the polling surface for a watchdog; `cloud.metadata` tags make "which pool seat is this?" a filter instead of a guess.
- `SDKMessage` stream events (tool calls with ids, step boundaries, usage per turn) map cleanly onto OTel GenAI `invoke_agent` / `execute_tool` spans; BDK's `defineOtel` exports them.
- Cloud agents can attach **artifacts** (screenshots, recordings) to PRs; `documentation-generator` and `demo-creator` can turn a run into a narrated demo.

## 7. What Cursor does *not* do (so we know what to build)

- No native self-chaining: an Automation cannot pick a prompt or environment at runtime or spawn a follow-on agent. A thin coordinator (SDK script, BDK agent, or a webhook-fed automation) is required for dynamic dispatch.
- No shared task board. The SDK's "kanban" is a sample app, not a service. Our board is the Obsidian vault (plus Beads if we ever need a graph).
- No pool-level watchdog. Agents have statuses (`CREATING | RUNNING | FINISHED | ERROR | CANCELLED | EXPIRED`), but nothing nudges or shelves a stalled seat.
- No cross-run memory beyond the repo, the PR, and whatever you persist. BDK `host.kv`, the vault, and SPDD's ledger are the candidates.
- Webhooks out of v1 are not shipped yet; use polling or the v0 webhook until then.

## 8. Sources

- [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript) · [SDK announcement](https://cursor.com/blog/typescript-sdk)
- [Cloud Agents API: endpoints](https://cursor.com/docs/cloud-agent/api/endpoints) · [overview](https://cursor.com/docs/cloud-agent/api/overview)
- [Cloud Agents](https://prod.cursor.com/docs/cloud-agent) · [Automations](https://cursor.com/docs/cloud-agent/automations) · [Hooks](https://prod.cursor.com/docs/hooks)
- [Self-Hosted Machines](https://cursor.com/docs/cloud-agent/self-hosted) · [Team Pools](https://cursor.com/docs/cloud-agent/self-hosted/pool)
- [Headless CLI](https://cursor.com/docs/cli/headless) · [CLI output format](https://cursor.com/docs/cli/reference/output-format)
- Forum: [workflow trigger is push-only](https://forum.cursor.com/t/github-workflow-trigger-is-unreliable/167362) · [API/SDK use under the terms](https://forum.cursor.com/t/is-this-use-of-cursor-cloud-agents-permitted-under-cursor-s-terms/168633)
- [Cursor worktrees guide (community)](https://baeseokjae.github.io/posts/cursor-worktrees-parallel-agents-2026/)
