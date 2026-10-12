# Agent Queue

Claimable work for the agent-automation demo harnesses. Claim with the full line text (or a unique substring such as the ID plus a word). A bare ID like `H1` is ambiguous on purpose. Specs live in `TODO/2026-10-12-*.md`; the plan is `docs/plan.md` in the repo.

## Foundation (wave 1)

- [ ] F1 Scaffold Node 22 TypeScript workspace with @cursor/sdk, vitest, eslint, and a tests.yml CI workflow #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F2 Write harness/spend.ts spend locks ported from dogfood-api agent-day with cancel-on-cap #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F3 Write harness/board.ts obsidian-mcp stdio client for list, claim, complete, block, and daily note #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F4 Write harness/gate.ts verify runner with repeated-error hash and Files allowlist diff check #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F5 Write harness/receipt.ts pool-run receipt schema and writer #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F6 Write harness/backends/scripted.ts deterministic fake backend for CI #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F7 Write harness/backends/cursor-cloud.ts wrapping Agent.create, resume, cancel, and usage #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F8 Write harness/backends/cursor-cli.ts wrapping agent -p --output-format stream-json #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F9 Write harness/otel.ts mapping SDK stream events to GenAI invoke_agent and execute_tool spans with a console exporter #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F10 Add .cursor/rules/pool-contract.mdc and .cursor/hooks.json with a shell deny-list and a stop-hook gate #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F11 Add .cursor/environment.json installing Node 22, uv, and obsidian-mcp into .tools #pool #foundation [repo::jmjava/agent-automation-]
- [ ] F12 Create fixture repo jmjava/pool-fixture with real CI, one hollow test, and a Files-scoped canvas #pool #foundation [repo::jmjava/pool-fixture]
- [ ] F13 Port slm-setup eval cases into harness/cases fixtures #pool #foundation [repo::jmjava/agent-automation-]

## H1 queue-pool

- [ ] H1.1 Implement h1-queue-pool coordinator loop: select, claim, launch, wait, refill at cap 7 #pool #h1 [repo::jmjava/agent-automation-]
- [ ] H1.2 Implement h1 PR check polling where a pending check never completes a task #pool #h1 [repo::jmjava/agent-automation-]
- [ ] H1.3 Write h1 scripted tests for refill order, cap, ambiguous claim, and pending check #pool #h1 [repo::jmjava/agent-automation-]
- [ ] H1.4 Run h1 live against pool-fixture and commit the first receipt baseline under evals #pool #h1 #live [repo::jmjava/agent-automation-]
- [ ] H1.5 Write h1 README with offline and live instructions #pool #h1 [repo::jmjava/agent-automation-]

## H2 event-loop

- [ ] H2.1 Write h2 automation prompts for the ready label, CI failure, and shelved label runs #pool #h2 [repo::jmjava/agent-automation-]
- [ ] H2.2 Write h2 webhook-post.ts that triggers a Cursor automation webhook endpoint #pool #h2 [repo::jmjava/agent-automation-]
- [ ] H2.3 Write h2 prompt lint asserting the four Kasana exit bullets are present #pool #h2 [repo::jmjava/agent-automation-]
- [ ] H2.4 Configure the three h2 automations in the Cursor dashboard on pool-fixture and document the steps #pool #h2 #manual [repo::jmjava/agent-automation-]
- [ ] H2.5 Run h2 end to end: labeled issue to PR, forced CI failure to one fix then shelf #pool #h2 #live [repo::jmjava/agent-automation-]

## H3 pipeline-gates

- [ ] H3.1 Implement h3 plan stage with a Files-required gate #pool #h3 [repo::jmjava/agent-automation-]
- [ ] H3.2 Implement h3 implement stage with diff allowlist and validation command gate #pool #h3 [repo::jmjava/agent-automation-]
- [ ] H3.3 Implement h3 verify stage mutation probe that flags hollow tests #pool #h3 [repo::jmjava/agent-automation-]
- [ ] H3.4 Implement h3 review stage as a read-only run returning approve or changes #pool #h3 [repo::jmjava/agent-automation-]
- [ ] H3.5 Write h3 fixture tests proving a hollow test and a Files violation are caught #pool #h3 [repo::jmjava/agent-automation-]
- [ ] H3.6 Run h3 live on pool-fixture and record four gate receipts #pool #h3 #live [repo::jmjava/agent-automation-]

## H4 best-of-n

- [ ] H4.1 Implement h4 deterministic scorer with hard and soft criteria #pool #h4 [repo::jmjava/agent-automation-]
- [ ] H4.2 Port decide_apply from slm-setup into the h4 picker gate #pool #h4 [repo::jmjava/agent-automation-]
- [ ] H4.3 Implement h4 fan-out of N cloud agents on one startingRef with autoCreatePR off #pool #h4 [repo::jmjava/agent-automation-]
- [ ] H4.4 Write h4 tests proving the picker never applies a candidate that failed a hard gate #pool #h4 [repo::jmjava/agent-automation-]
- [ ] H4.5 Run h4 live with three models and commit the pick receipt #pool #h4 #live [repo::jmjava/agent-automation-]

## H5 router-tiers

- [ ] H5.1 Wire slm-setup route and next_plan into h5 through its MCP bridge #pool #h5 [repo::jmjava/agent-automation-]
- [ ] H5.2 Implement h5 premium review run that replaces the self-assessment in the slm-setup results note #pool #h5 [repo::jmjava/agent-automation-]
- [ ] H5.3 Add h5 needs-gpu routing to env type pool #pool #h5 [repo::jmjava/agent-automation-]
- [ ] H5.4 Reproduce the slm-setup closed-loop table as an h5 receipt #pool #h5 #live [repo::jmjava/agent-automation-]

## H6 ralph-bounded

- [ ] H6.1 Implement h6 iteration loop with fresh context per send and a completion promise #pool #h6 [repo::jmjava/agent-automation-]
- [ ] H6.2 Implement h6 max-iterations and repeated-error stop #pool #h6 [repo::jmjava/agent-automation-]
- [ ] H6.3 Persist h6 iteration progress to the vault session note so a crashed coordinator can resume #pool #h6 [repo::jmjava/agent-automation-]
- [ ] H6.4 Write h6 tests: converge at iteration three, stop after two identical errors #pool #h6 [repo::jmjava/agent-automation-]
- [ ] H6.5 Run h6 live on a multi-step fixture task and record one receipt per iteration #pool #h6 #live [repo::jmjava/agent-automation-]

## H7 patrol

- [ ] H7.1 Implement h7 seat classifier over GET v1 agents filtered by metadata tag #pool #h7 [repo::jmjava/agent-automation-]
- [ ] H7.2 Implement h7 action table: nudge, cancel, block, noop with an idempotency record #pool #h7 [repo::jmjava/agent-automation-]
- [ ] H7.3 Implement h7 exponential backoff when the patrol finds no work #pool #h7 [repo::jmjava/agent-automation-]
- [ ] H7.4 Write h7 tests over fixture agent lists in every seat state #pool #h7 [repo::jmjava/agent-automation-]
- [ ] H7.5 Schedule h7 as a no-repository Cursor automation and run it over h1 seats for a day #pool #h7 #live [repo::jmjava/agent-automation-]

## H8 bdk-coordinator

- [ ] H8.1 Scaffold the h8 BDK agent with bot/agent.ts and instructions.md #pool #h8 [repo::jmjava/agent-automation-]
- [ ] H8.2 Expose h1 board logic and h3 gates as h8 server tools #pool #h8 [repo::jmjava/agent-automation-]
- [ ] H8.3 Store h8 pool state in host.kv with a run-id prefix and exp #pool #h8 [repo::jmjava/agent-automation-]
- [ ] H8.4 Add h8 Slack and GitHub channels and a turn.completed follow-up hook #pool #h8 [repo::jmjava/agent-automation-]
- [ ] H8.5 Write h8 evals that replay recorded channel events #pool #h8 [repo::jmjava/agent-automation-]
- [ ] H8.6 Run h8 one Slack-triggered pool run end to end #pool #h8 #live [repo::jmjava/agent-automation-]

## H9 self-hosted-pool

- [ ] H9.1 Document h9 agent worker start with pool gpu, worker-dir, and on-session-start #pool #h9 [repo::jmjava/agent-automation-]
- [ ] H9.2 Write h9 prepare.sh and worker-dir rules for the Ollama workstation #pool #h9 [repo::jmjava/agent-automation-]
- [ ] H9.3 Write h9 controller stub: watch queue, claim request, start worker, with tests #pool #h9 [repo::jmjava/agent-automation-]
- [ ] H9.4 Route one needs-gpu task to the gpu pool and record pool and worker id in the receipt #pool #h9 #live [repo::jmjava/agent-automation-]

## Cross-cutting

- [ ] X1 Add evals baseline comparison that fails CI on a receipt regression #pool #xcut [repo::jmjava/agent-automation-]
- [ ] X2 Add maintainability ratchets workflow matching obsidian-mcp and slm-setup #pool #xcut [repo::jmjava/agent-automation-]
- [ ] X3 Record one demo video per harness with documentation-generator #pool #xcut [repo::jmjava/agent-automation-]
