# H1 — queue-pool

**Pattern:** Parallel workers from the vault board, cap 7, refill on exit.

**Proves:** A Markdown vault is a sufficient task board for a 7-seat cloud pool.

**Trends:** T2 isolation, T3 atomic claims, T4 parallel workers, T11 model pinning, T13 receipts.

## How it works

1. The coordinator reads `list_open_tasks` from the vault via `board.ts`.
2. It applies the selection order and claims up to `cap` tasks.
3. For each claimed task, it launches one cloud agent (`autoCreatePR: true`).
4. It waits for each run to finish, reads PR checks.
5. On exit: `complete_task` (all checks green) or `block_task` (failure or spend lock tripped).
6. When a seat exits, the next open task refills it.

## Offline mode

```bash
npm test -- harnesses/h1-queue-pool/
```

The `ScriptedBackend` returns canned PR URLs and check states. Tests assert
refill order, cap enforcement, uniqueness, and that a `pending` check never
completes a task.

## Live mode

```bash
CURSOR_USER_API_KEY=... npx tsx harnesses/h1-queue-pool/run.ts
```

Requires `OBSIDIAN_VAULT_PATH` for board access. Produces a receipt in
`receipts/` and a daily-note entry.
