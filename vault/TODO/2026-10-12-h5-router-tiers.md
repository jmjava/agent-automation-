---
status: open
project: agent-automation
kind: epic
wave: 4
harness: h5-router-tiers
pattern: routing
trends: T11 T1 T12
---

# H5 router-tiers: local SLM → premium review → apply, plus a gpu pool

Proves delegation to a local model is safe when apply is gated by premium review and re-scoring.

## Owns these Agent Queue lines

H5.1 through H5.4.

## Behavior

1. `route(signals, files)` from `slm-setup` decides keep or delegate (spec §8 do-not-delegate list: incidents, architecture, live tools, ambiguous).
2. Delegated mechanical tasks go to the `local_coding_slm` MCP (`next_plan`: fast → repair → strong) and are scored with the layer oracle.
3. A premium Cursor run reviews the packet (local text, layers, first failure, local review notes) and returns accept / rewrite / reject. This replaces the self-assessment in `slm-setup/docs/cloud-orchestrator-results-2026-09-07.md`.
4. `decide_apply` gates; rewrites are re-scored.
5. Tasks tagged `needs-gpu` are created with `env: { type: "pool", name: "gpu" }` (see H9).
6. Receipt reproduces the closed-loop table: jobs, delegated, applied, held, with reviewer and reason per job.

## Files

`harnesses/h5-router-tiers/run.ts`, `review-prompt.md`, `cases.json`, `README.md`, `evals/h5.eval.ts`. Python side stays in `slm-setup`; call it through its MCP bridge, do not vendor it.

## Offline mode

`slm-setup` `stub_ollama` plus a scripted reviewer; `run_orchestration.py` metrics become the receipt.

## Done when

The closed-loop table is reproduced with a real premium reviewer run; keep jobs never called `local_*`; rejected jobs with passing local layers still did not apply.
