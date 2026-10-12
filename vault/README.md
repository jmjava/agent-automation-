# Vault task lists

Markdown that `obsidian-mcp` parses as claimable work, so agents can build the demo harnesses from the plan one task at a time.

| Path | Role in the MCP |
| --- | --- |
| `AI Memory/Agent Queue.md` | Every claimable subtask (61 lines, unique IDs `F1…F13`, `H1.1…H9.4`, `X1…X3`), tagged `#pool #<wave>` with `[repo::…]`. `list_open_tasks` lists unchecked lines; `claim_task` / `complete_task` check the matching box. |
| `AI Memory/Projects/agent-automation/Project State.md` | Objective, architecture, blockers, and **Next Steps = wave 1 (F1–F13)** with text identical to the queue lines, so one claim moves the bullet to In Progress *and* checks the queue box. `update_project_state` and the task tools rewrite it while preserving sections. |
| `TODO/2026-10-12-*.md` | One note per epic (foundation + H1–H9), `status: open`, `project: agent-automation`. The H1 title is claimable as the epic; the body is the spec an agent needs (behavior, files, offline mode, done-when). |

## Feed it into your vault

```bash
python3 scripts/seed_vault.py --vault "$OBSIDIAN_VAULT_PATH" --dry-run
python3 scripts/seed_vault.py --vault "$OBSIDIAN_VAULT_PATH"
```

Merge-safe: the queue only gains lines whose canonical text is not already present (checked or unchecked), an existing `Project State.md` is left alone unless `--force-project-state`, and existing TODO notes are never overwritten. Re-running is a no-op. Honors `OBSIDIAN_MEMORY_ROOT`.

## How an agent should consume it

Claim with the **full queue line** or a unique substring such as `H1.1 Implement h1-queue-pool`. A bare `H1` is ambiguous (it matches the epic and every `H1.x` line) and fails closed without moving anything; that is the MCP's uniqueness rule working.

Prompt skeleton for a Cursor agent (local chat or cloud) with the `obsidian-dev-memory` MCP attached:

```
Call get_project_context("agent-automation") and read docs/plan.md §0 and §1.
Call list_open_tasks("agent-automation") and pick the first #foundation line that is not In Progress.
Call claim_task("agent-automation", "<full line>").
Read the matching TODO note (TODO/2026-10-12-f-foundation.md) for Files and Done-when.
Touch only those files plus tests. Run npm test and lint; commit and push only on exit 0. Open a PR.
Read gh pr checks until the run finishes. Pending is not a pass.
Call capture_work_session with repository_path. If every check is success, call complete_task; otherwise call block_task with the reason.
Do not start a second task.
```

## Waves

| Wave | Lines | Depends on |
| --- | --- | --- |
| 1 | F1–F13 | nothing |
| 2 | H1.x, H3.x, H4.x | wave 1 |
| 3 | H2.x, H6.x, H7.x | H1 (H7 watches H1 seats), H3 (H6 reuses the gate) |
| 4 | H5.x, H9.x | H4's apply gate; a workstation for H9 |
| 5 | H8.x | everything above as functions |
| any | X1–X3 | X1 after the first receipt baseline |

When wave 1 completes, either move the wave-2 queue lines into Project State Next Steps (same text) or let agents claim them straight from the queue; both paths are supported.

`#live` lines spend money and need `CURSOR_USER_API_KEY` plus the F2 spend locks. `#manual` lines end with a human step; the agent writes the runbook and stops.
