---
status: open
project: agent-automation
kind: epic
wave: 2
harness: h3-pipeline-gates
pattern: pipeline
trends: T1 T4 T5 T6
---

# H3 pipeline-gates: plan → implement → verify → review with deterministic gates

Proves stage gates between runs catch hollow tests and scope creep that CI alone misses.

## Owns these Agent Queue lines

H3.1 through H3.6.

## Stages

| Stage | Who | Gate to proceed |
| --- | --- | --- |
| plan | agent run | output contains an operation with `Files:` and validation commands; otherwise re-prompt once, then block |
| implement | agent run (same agent, next `send`) | `git diff --name-only ⊆ Files: ∪ tests`; validation commands exit 0 |
| verify | **deterministic**, no agent | suite passes; mutation probe on each changed function (swap return value, confirm a test fails); hollow test → block with the function name |
| review | read-only agent run or Bugbot | output is exactly `approve` or `changes: <list>`; `changes` feeds one more implement pass, then repeat-stop |

Gate output is pasted verbatim into the next stage's prompt ("show the failing rule"). Repeat-stop applies at every stage.

## Files

`harnesses/h3-pipeline-gates/run.ts`, `stages/*.ts`, `probe.ts` (mutation probe), `cases.json`, `README.md`, `evals/h3.eval.ts`.

## Offline mode

Fixtures from `harness/cases/`: one hollow-test fixture must be caught at verify; one `Files:` violation must be caught at implement; one clean fixture passes four gates.

## Done when

Scripted fixtures meet expectations in CI; a live run on `pool-fixture` yields a PR whose receipt shows four gates with evidence (commands, outputs, probe results).
