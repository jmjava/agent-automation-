---
status: open
project: agent-automation
kind: epic
wave: 3
harness: h6-ralph-bounded
pattern: bounded-loop
trends: T8 T1 T10
---

# H6 ralph-bounded: fresh-context iterations with a completion promise

Proves bounded fresh-context iteration beats one long context.

## Owns these Agent Queue lines

H6.1 through H6.5.

## Behavior

1. Input: a phased prompt with acceptance criteria per phase and a completion promise string.
2. Each iteration is a new `agent.send()` on the same cloud agent (fresh context, same workspace) or a new agent on the same branch; artifacts persist in Git.
3. After each iteration: run the gate; append `{iteration, hash, gateResult}` to the vault session note via `capture_work_session`.
4. Loop ends when the promise string appears **and** the gate passes.
5. Stops: `--max-iterations` (default 6); repeated-error hash twice; any spend lock.
6. On coordinator crash: `Agent.resume(id)` and continue from the last recorded iteration in the session note.

## Files

`harnesses/h6-ralph-bounded/run.ts`, `phases.md`, `cases.json`, `README.md`, `evals/h6.eval.ts`.

## Offline mode

Scripted iterations converging at iteration three; a variant repeating the same error twice must stop at two; a resume test replays from a recorded session note.

## Done when

A live multi-step fixture task completes in at most N iterations with one receipt per iteration and the vault session note shows every iteration.
