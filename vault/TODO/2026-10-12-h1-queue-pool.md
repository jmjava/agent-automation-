---
status: open
project: agent-automation
kind: epic
wave: 2
harness: h1-queue-pool
pattern: parallel-workers
trends: T2 T3 T4 T11 T13
---

# H1 queue-pool: parallel workers from the vault board

Proves a Markdown vault is enough board for a 7-seat cloud pool.

## Owns these Agent Queue lines

H1.1 through H1.5.

## Behavior

1. Coordinator calls `listOpen("pool-fixture")`, applies `quality_pool_flow` selection order, skips items the current pool note holds.
2. Refuses to fan out with fewer than three independent tasks (rule of 3) and says so in the receipt.
3. For each seat up to `cap` (default 7): `claim`, build the prompt (task text + `pool-contract.mdc` + the four Kasana exit bullets), `create` a cloud agent with `autoCreatePR: true` and `metadata: { pool, seat, task }`, guard it with `spend.ts`.
4. On run finish: poll PR checks until the run finishes. All `success` → `complete`. Any failure → one follow-up run with the failing output; a second identical failure → `block` with the pitfall. Pending never completes.
5. When a seat exits, refill from the board. Stop when the board is empty or the wall budget trips.
6. Write one receipt and one `append_daily_note("Pool", summary)`.

## Files

`harnesses/h1-queue-pool/run.ts`, `cases.json`, `README.md`, `evals/h1.eval.ts`, `evals/baselines/h1.json`.

## Offline mode

`--backend scripted`. Tests: refill order follows selection order; cap is respected; an ambiguous claim leaves the board untouched and the seat empty; a `pending` check never completes; the receipt summary counts match seat outcomes.

## Live mode

Needs `CURSOR_USER_API_KEY`, `OBSIDIAN_VAULT_PATH`, and the F12 fixture repo with three ready tasks. Pin `composer-2.5`. Expected cost: three short runs.

## Done when

Scripted tests green in CI; one live run produced three PRs, a receipt, and a daily-note entry; the receipt is committed as `evals/baselines/h1.json`.
