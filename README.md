# @jmjava/agent-automation

Orchestration harnesses for running **pools of coding agents** on Cursor — with spend locks, verification gates, task-board integration, OTel tracing, and structured receipts. We write orchestrators and gates, never the editing loop.

---

## Architecture

```
agent-automation-/
│
├── harness/                        ← shared TypeScript library
│   ├── index.ts                       barrel export
│   ├── spend.ts                       4 spend-lock caps + guard()
│   ├── gate.ts                        runVerify, errorHash, repeatStop, filesAllowlist
│   ├── receipt.ts                     PoolReceipt schema + atomic writeReceipt
│   ├── board.ts                       obsidian-mcp client (live vault board)
│   ├── board-scripted.ts              in-memory Board for tests
│   ├── otel.ts                        PoolTracer / AgentTracer → OTel GenAI spans
│   └── backends/
│       ├── types.ts                   AgentBackend + CreateAgentOpts interface
│       ├── scripted.ts                deterministic fake for CI (ScriptedBackend)
│       ├── cursor-cloud.ts            @cursor/sdk Agent.create({cloud}) wrapper
│       └── cursor-cli.ts             `cursor agent -p` child-process wrapper
│
├── harnesses/                      ← runnable coordinators
│   ├── h1-queue-pool/                 parallel workers, vault board, cap + refill
│   └── h3-pipeline-gates/            sequential stages with verify gates
│
├── fixtures/
│   └── pool-target/                mini repo with stub functions + tests
│
├── docs/
│   ├── survey.md                   literature survey (15 trends, 40+ sources)
│   ├── plan.md                     9 harness designs (H1–H9)
│   └── cursor-techniques.md        every Cursor surface for agent automation
│
└── .cursor/
    ├── rules/pool-contract.mdc     always-apply rules for pool workers
    └── hooks.json                  deny dangerous shell commands
```

Data flow:

```
Board (vault or scripted)
  │  listOpen → claim → complete/block
  ▼
Harness (H1, H3, …)
  │  fillSeats, spend guard, verify gates
  │  ├── Backend.create(opts) → AgentRun
  │  ├── guard(run, spend, …) → tripped?
  │  ├── runVerify(commands) → pass/fail
  │  ├── errorHash + repeatStop
  │  └── writeReceipt(receipt, path)
  ▼
Receipt (JSON) + OTel trace + daily-note summary
```

---

## Quick start

```bash
# Clone and install
git clone https://github.com/jmjava/agent-automation-.git
cd agent-automation-
npm install

# Run the test suite
npm test

# Type-check
npm run typecheck

# Lint
npm run lint
```

**Node ≥ 22** is required.

Import from the barrel:

```typescript
import {
  runPool,
  runPipeline,
  ScriptedBackend,
  ScriptedBoard,
  guard,
  runVerify,
  errorHash,
  writeReceipt,
  initTracing,
} from "./harness/index.js";
```

---

## Library modules

| Module | Path | Description |
|--------|------|-------------|
| **spend** | `harness/spend.ts` | 4 spend-lock caps (`maxTotalTokens`, `runTimeout`, `maxSends`, `wallBudget`); `guard()` cancels the run when any cap trips |
| **gate** | `harness/gate.ts` | `runVerify()` — run shell commands as gates; `errorHash()` — stable SHA-256 ignoring timestamps/PIDs; `repeatStop()` — true when the last two hashes match; `filesAllowlist()` — diff paths vs allowed files + globs |
| **receipt** | `harness/receipt.ts` | `PoolReceipt` / `SeatResult` schema; `summarize()` counts; `writeReceipt()` atomic write (tmp + rename) |
| **board** | `harness/board.ts` | Live `Board` backed by obsidian-mcp over stdio (MCP client → `list_open_tasks`, `claim_task`, `complete_task`, `block_task`, `unblock_task`, `append_daily_note`) |
| **board-scripted** | `harness/board-scripted.ts` | In-memory `Board` for tests; records every call to `callLog`; pre-load with `TaskItem[]` |
| **otel** | `harness/otel.ts` | `initTracing()` / `shutdownTracing()`; `PoolTracer` (root `invoke_workflow` span) → `AgentTracer` (per-seat `invoke_agent` span with `startTool` / `endTool` / `recordUsage`) |
| **backends/types** | `harness/backends/types.ts` | `AgentBackend` interface: `create(opts)`, optional `resume(id)`, optional `cancel(id)` |
| **backends/scripted** | `harness/backends/scripted.ts` | `ScriptedBackend` — replays canned `ScriptedRunConfig[]`; `ScriptedRun` with settable tokens and cancel; `callLog` for assertions |
| **backends/cursor-cloud** | `harness/backends/cursor-cloud.ts` | `CursorCloudBackend` — wraps `@cursor/sdk` `Agent.create({ cloud })` / `Agent.resume()`; reads `CURSOR_USER_API_KEY` |
| **backends/cursor-cli** | `harness/backends/cursor-cli.ts` | `CursorCliBackend` — spawns `cursor agent -p --output-format stream-json`; `CursorCliRun` parses NDJSON events, tracks tokens, exposes `wait()` |

---

## Backends

Every harness accepts an `AgentBackend`, so the same coordinator logic works offline (CI) or live (real agents).

### ScriptedBackend (CI / tests)

Zero-spend, deterministic. Pre-load with the exact sequence of runs and their token counts:

```typescript
import { ScriptedBackend, type ScriptedRunConfig } from "./harness/backends/scripted.js";

const configs: ScriptedRunConfig[] = [
  {
    agentId: "agent-1",
    events: [{ type: "run_finished", data: {} }],
    tokens: 2500,
  },
  {
    agentId: "agent-2",
    events: [{ type: "error", data: { message: "build failed" } }],
    tokens: 800,
  },
];

const backend = new ScriptedBackend(configs);
const run = await backend.create({ prompt: "fix the bug", model: "test", repo: "", ref: "main", metadata: {} });
console.log(run.usage.totalTokens); // 2500
console.log(run.agentId);           // "agent-1"

// Every call is logged for test assertions
console.log(backend.callLog);
// [{ method: "create", args: [{ prompt: "fix the bug", ... }] }]
```

### CursorCloudBackend (live cloud agents)

Wraps `@cursor/sdk`. Each `create()` call spawns a cloud agent VM:

```typescript
import { CursorCloudBackend } from "./harness/backends/cursor-cloud.js";

const backend = new CursorCloudBackend(process.env.CURSOR_USER_API_KEY);

const run = await backend.create({
  repo: "jmjava/pool-fixture",
  ref: "main",
  prompt: "Implement the multiply function in src/math.ts",
  model: "composer-2.5",
  metadata: { pool: "weekend-batch", task: "math-multiply" },
  autoCreatePR: true,
});

console.log(run.usage.totalTokens);
await run.cancel(); // if a spend cap trips
```

**Key type note:** `CURSOR_USER_API_KEY` must be a Cursor user/service-account key (not an OpenAI `sk-proj-*` key). The constructor validates this.

### CursorCliBackend (headless local)

Spawns `cursor agent -p` as a child process and parses NDJSON from stdout:

```typescript
import { CursorCliBackend } from "./harness/backends/cursor-cli.js";

const backend = new CursorCliBackend("/usr/local/bin/cursor");
const run = await backend.create({
  prompt: "Add error handling to the divide function",
  model: "default",
  repo: "",
  ref: "main",
  metadata: {},
});

await run.wait();  // blocks until the CLI exits
console.log(run.events);        // all parsed CliEvent[]
console.log(run.resultContent);  // final result text
console.log(run.usage.totalTokens);
```

---

## Board

The board is the task-management layer. In production, it connects to the **obsidian-dev-memory** MCP server over stdio, giving the coordinator access to a human-readable, Git-diffable Obsidian vault as the task board.

### Live board (obsidian-mcp)

```typescript
import { createBoard } from "./harness/board.js";

const board = createBoard("/home/ubuntu/obsidian-vault");

const tasks = await board.listOpen("agent-automation");
const claimed = await board.claim("agent-automation", tasks[0].title);

// ... agent works on the task ...

await board.complete(claimed.id, "PR #42 merged, all checks green");
// or
await board.block(claimed.id, "Repeat error: verify failed twice");

await board.appendDaily("H1 pool", "3 completed, 0 blocked (12500 tokens)");
await board.close();
```

The MCP connection is **lazy** — it starts on the first call, not at construction. The coordinator is the only process that holds the vault handle; cloud agents never mount it directly.

### ScriptedBoard (tests)

```typescript
import { ScriptedBoard } from "./harness/board-scripted.js";

const board = new ScriptedBoard([
  { id: "task-1", title: "Implement multiply", project: "demo" },
  { id: "task-2", title: "Implement divide", project: "demo" },
  { id: "task-3", title: "Implement factorial", project: "demo" },
]);

// Use it exactly like a live board — every call is recorded
const tasks = await board.listOpen("demo");
await board.claim("demo", "Implement multiply");

console.log(board.callLog);
// [{ method: "listOpen", args: ["demo"] }, { method: "claim", args: ["demo", "Implement multiply"] }]

console.log(board.tasks); // remaining tasks (task-2, task-3)
```

---

## Harnesses

### H1: Queue Pool (`harnesses/h1-queue-pool/run.ts`)

Parallel workers from a task board with cap, refill, retry, and repeat-stop.

**Flow:**
1. List open tasks from the board
2. **Rule of 3** — refuse to fan out with < 3 tasks
3. Fill seats up to `cap`, claiming each task
4. For each seat: spend guard → verify → complete or block
5. **Repeat-stop:** same `errorHash` twice → block immediately
6. **Retry once** on first failure
7. Refill freed seats from remaining tasks
8. Stop when board is empty or wall budget exceeded
9. Write receipt + append daily summary

```typescript
import { runPool, type PoolConfig } from "./harnesses/h1-queue-pool/run.js";
import { ScriptedBackend } from "./harness/backends/scripted.js";
import { ScriptedBoard } from "./harness/board-scripted.js";

const board = new ScriptedBoard([
  { id: "t1", title: "Implement multiply", project: "demo" },
  { id: "t2", title: "Implement divide", project: "demo" },
  { id: "t3", title: "Implement factorial", project: "demo" },
  { id: "t4", title: "Implement capitalize", project: "demo" },
]);

const backend = new ScriptedBackend([
  { agentId: "a1", events: [{ type: "run_finished", data: {} }], tokens: 1000 },
  { agentId: "a2", events: [{ type: "run_finished", data: {} }], tokens: 1200 },
  { agentId: "a3", events: [{ type: "run_finished", data: {} }], tokens: 900 },
  { agentId: "a4", events: [{ type: "run_finished", data: {} }], tokens: 1100 },
]);

const config: PoolConfig = {
  poolId: "weekend-batch",
  project: "demo",
  cap: 3,
  spend: {
    model: "composer-2.5",
    maxSends: 50,
    runTimeoutMs: 300_000,
    maxTotalTokens: 500_000,
    wallMs: 600_000,
  },
  verify: ["npm test"],
  receiptPath: "/tmp/h1-receipt.json",
};

const receipt = await runPool(config, backend, board);
console.log(receipt.summary);
// { completed: 4, blocked: 0, cancelled: 0, totalTokens: 4200 }
```

### H3: Pipeline Gates (`harnesses/h3-pipeline-gates/run.ts`)

Sequential multi-stage pipeline where each stage has a verification gate.

**Flow:**
1. For each stage: build prompt → create agent → run verify commands
2. If verify fails → mark stage failed, skip all remaining stages
3. Optional `filesAllowlist` gate per stage
4. Write receipt with per-stage results

```typescript
import { runPipeline, defaultStages, type PipelineConfig } from "./harnesses/h3-pipeline-gates/run.js";
import { ScriptedBackend } from "./harness/backends/scripted.js";

const backend = new ScriptedBackend([
  { agentId: "plan-agent", events: [], tokens: 500 },
  { agentId: "impl-agent", events: [], tokens: 2000 },
  { agentId: "verify-agent", events: [], tokens: 1500 },
  { agentId: "review-agent", events: [], tokens: 800 },
]);

const config: PipelineConfig = {
  pipelineId: "auth-feature",
  task: "add JWT authentication to the /api/users endpoint",
  stages: defaultStages({
    implement: { model: "claude-4-opus" },      // premium model for implementation
    verify: { verify: ["npm test", "npm run lint", "npm run typecheck"] },
  }),
  spend: {
    model: "composer-2.5",
    maxSends: 100,
    runTimeoutMs: 300_000,
    maxTotalTokens: 1_000_000,
    wallMs: 600_000,
  },
  receiptPath: "/tmp/h3-receipt.json",
};

const receipt = await runPipeline(config, backend);
console.log(receipt.finalStatus);  // "success" or "failed"
console.log(receipt.stages.map(s => `${s.stage}: ${s.status}`));
// ["plan: success", "implement: success", "verify: success", "review: success"]
```

The `defaultStages()` factory produces 4 stages (plan → implement → verify → review) with sensible defaults. Override individual stages:

```typescript
const stages = defaultStages({
  plan: { verify: ["echo plan-ok"] },
  review: { model: "claude-4-opus", prompt: "Security review of: {task}" },
});
```

---

## Spend locks

Every agent run is guarded by 4 caps. When any cap trips, `guard()` calls `run.cancel()` and returns which lock fired.

| Lock | Config field | What it caps |
|------|-------------|--------------|
| **maxTotalTokens** | `maxTotalTokens` | Cumulative tokens from `run.usage.totalTokens` |
| **runTimeout** | `runTimeoutMs` | Elapsed time since the run started |
| **maxSends** | `maxSends` | Number of prompt sends to the agent |
| **wallBudget** | `wallMs` | Wall-clock time for the entire pool/pipeline |

```typescript
import { guard, type SpendConfig, type AgentRun } from "./harness/spend.js";

const config: SpendConfig = {
  model: "composer-2.5",
  maxSends: 50,
  runTimeoutMs: 300_000,      // 5 minutes per run
  maxTotalTokens: 500_000,    // 500k tokens max
  wallMs: 1_800_000,          // 30 minutes wall budget
};

// In a loop, periodically check:
const result = await guard(run, config, startTime, sendCount);

if (result.tripped) {
  console.log(`Spend lock tripped: ${result.lockName}`);
  console.log(`Usage: ${result.usage.tokens} tokens, ${result.usage.elapsedMs}ms`);
  // run.cancel() was already called by guard()
}
```

---

## Gates

### `runVerify(commands)`

Execute shell commands sequentially. Each returns `{ command, exitCode, output }`:

```typescript
import { runVerify } from "./harness/gate.js";

const results = await runVerify(["npm test", "npm run lint"]);
const allPassed = results.every(r => r.exitCode === 0);
```

Commands run with a 120-second timeout and 10 MB output buffer.

### `errorHash(output)`

Stable SHA-256 hash of command output with volatile text stripped (timestamps, PIDs, durations, epoch values):

```typescript
import { errorHash } from "./harness/gate.js";

const hash = errorHash(failedOutput);
// Same logical error → same hash, regardless of when it ran
```

### `repeatStop(history)`

Returns `true` when the last two hashes in the history array are identical:

```typescript
import { repeatStop } from "./harness/gate.js";

const hashes: string[] = [];
hashes.push(errorHash(output1));  // "abc123..."
hashes.push(errorHash(output2));  // "abc123..." (same error)

repeatStop(hashes); // true → stop retrying, block the task
```

### `filesAllowlist(diffPaths, allowedFiles, testGlobs)`

Check that every changed file is either explicitly allowed or matches a test glob:

```typescript
import { filesAllowlist } from "./harness/gate.js";

const result = filesAllowlist(
  ["src/auth.ts", "src/secret.ts", "src/auth.test.ts"],
  ["src/auth.ts"],                    // explicitly allowed
  ["**/*.test.*", "**/__tests__/**"], // test globs always OK
);

console.log(result.violations); // ["src/secret.ts"]
```

---

## Receipts

Every pool run produces a structured JSON receipt — the artifact that evals compare against baselines.

### PoolReceipt schema

```typescript
interface PoolReceipt {
  poolId: string;
  harness: string;           // "h1-queue-pool"
  started: string;           // ISO 8601
  finished: string;          // ISO 8601
  cap: number;
  seats: SeatResult[];
  summary: {
    completed: number;
    blocked: number;
    cancelled: number;
    totalTokens: number;
  };
}

interface SeatResult {
  task: string;
  agentId: string;
  model: string;
  status: "completed" | "blocked" | "cancelled";
  pr: string | null;
  checks: Record<string, "success" | "failure" | "pending">;
  tokens: number;
  trippedLock: string | null;
  blockedReason: string | null;
}
```

### Writing receipts

`writeReceipt()` is atomic: writes to a `.tmp` file, then renames:

```typescript
import { writeReceipt, summarize, type PoolReceipt } from "./harness/receipt.js";

const receipt: PoolReceipt = {
  poolId: "batch-42",
  harness: "h1-queue-pool",
  started: new Date().toISOString(),
  finished: new Date().toISOString(),
  cap: 7,
  seats: seatResults,
  summary: summarize(seatResults),
};

await writeReceipt(receipt, "./receipts/batch-42.json");
```

---

## OTel tracing

OpenTelemetry GenAI-style spans for every pool run. Console exporter by default; configure OTLP via `OTEL_EXPORTER_OTLP_ENDPOINT`.

```typescript
import { initTracing, shutdownTracing, PoolTracer } from "./harness/otel.js";

// Initialize at startup
const memExporter = initTracing({ inMemory: true }); // or {} for console

// One trace per pool run
const poolTracer = new PoolTracer("batch-42");

// One child span per agent seat
const agentTracer = poolTracer.startAgent("seat-1", "task-multiply", "composer-2.5");

// Track tool calls within the agent
const toolId = agentTracer.startTool("shell", { command: "npm test" });
agentTracer.endTool(toolId, "exit 0");

// Record token usage
agentTracer.recordUsage(2500);
agentTracer.recordMessage("Implemented multiply function");

// Close spans
agentTracer.end("ok");
poolTracer.end({ completed: 3, blocked: 1, totalTokens: 8500 });

// Shutdown at exit
await shutdownTracing();
```

**Span hierarchy:**

```
invoke_workflow (pool.id = "batch-42")
├── invoke_agent (seat.id = "seat-1", task.id = "task-multiply", gen_ai.request.model = "composer-2.5")
│   ├── execute_tool (tool.name = "shell")
│   └── execute_tool (tool.name = "file_edit")
├── invoke_agent (seat.id = "seat-2", ...)
└── ...
```

---

## Pool contract

The file `.cursor/rules/pool-contract.mdc` (`alwaysApply: true`) enforces these rules on every agent in the pool:

1. Never edit files under `.github/workflows/`
2. Never `git push --force` or `git push -f`
3. Never `rm -rf` outside the repo root
4. Always run the verify commands before declaring done
5. If a test fails twice with the same error, stop and report
6. Do not self-chain or spawn follow-up agents
7. Write a receipt file when done

### Hooks enforcement

`.cursor/hooks.json` implements a `beforeShellExecution` hook that denies:
- `push --force` / `push -f`
- `rm -rf /`
- Any command touching `.github/workflows`

The hook runs `scripts/hooks/deny-dangerous.sh` before matching shell commands execute.

---

## Test fixture

`fixtures/pool-target/` is a minimal TypeScript repo with **stub functions** and **pre-written tests** — designed so each task is "implement one function and make its tests pass."

```
fixtures/pool-target/
├── package.json          (vitest, npm test)
├── cases.json            5 tasks (Rule-of-3 compatible)
├── src/
│   ├── math.ts           add ✓, subtract ✓, multiply ✗, divide ✗, factorial ✗
│   ├── math.test.ts      tests for all functions
│   ├── string-utils.ts   capitalize ✗, truncate ✗, slugify ✗
│   └── string-utils.test.ts
└── .cursor/rules/pool-target.mdc
```

Each task in `cases.json` maps to one stub function:

```json
[
  {"id": "math-multiply", "text": "Implement the multiply function in src/math.ts. Run npm test to verify."},
  {"id": "math-divide", "text": "Implement the divide function in src/math.ts with zero-check. Run npm test to verify."},
  {"id": "math-factorial", "text": "Implement the factorial function in src/math.ts. Handle 0 and negative inputs. Run npm test to verify."},
  {"id": "string-capitalize", "text": "Implement capitalize in src/string-utils.ts. Run npm test to verify."},
  {"id": "string-truncate-slugify", "text": "Implement truncate and slugify in src/string-utils.ts. Run npm test to verify."}
]
```

The pool-target rules (`.cursor/rules/pool-target.mdc`) enforce: one function per task, run `npm test`, don't modify test files, don't add dependencies.

---

## Writing a custom scorer

For best-of-N or tournament harnesses, write a scorer as a plain function:

```typescript
interface CandidateScore {
  candidateId: string;
  testsPass: boolean;        // hard gate
  filesHonored: boolean;     // hard gate
  mutationScore: number;     // 0–1, soft
  diffSize: number;          // lines, soft (lower is better)
  tokenCost: number;         // soft (lower is better)
}

function scoreCandidates(candidates: CandidateScore[]): CandidateScore | null {
  // Hard gates: filter out candidates that failed tests or touched forbidden files
  const viable = candidates.filter(c => c.testsPass && c.filesHonored);
  if (viable.length === 0) return null;

  // Soft scoring: prefer high mutation score, small diff, low cost
  viable.sort((a, b) => {
    const scoreA = a.mutationScore * 100 - a.diffSize * 0.1 - a.tokenCost * 0.001;
    const scoreB = b.mutationScore * 100 - b.diffSize * 0.1 - b.tokenCost * 0.001;
    return scoreB - scoreA;
  });

  return viable[0];
}
```

---

## Docs

| Document | Description |
|----------|-------------|
| [docs/survey.md](docs/survey.md) | Literature survey: 15 trends (T1–T15) across harness engineering, isolation, coordination, verification, spec-driven dev, memory, observability, and more. 40+ sources. |
| [docs/plan.md](docs/plan.md) | Implementation plan for 9 harnesses (H1–H9) with rules, layout, dependencies, and non-goals. |
| [docs/cursor-techniques.md](docs/cursor-techniques.md) | Every Cursor surface for agent automation: SDK, CLI, Cloud API, Automations, hooks, self-hosted pools, spend controls, and known caveats. |

---

## Development

### Run tests

```bash
npm test               # vitest run (all tests)
npm run test:watch     # vitest in watch mode
```

Tests use `ScriptedBackend` and `ScriptedBoard` — no API keys, no vault, no network.

### Lint and type-check

```bash
npm run lint           # eslint on harness/ and harnesses/
npm run typecheck      # tsc --noEmit
```

### Add a new harness

1. Create `harnesses/hN-<name>/run.ts` with a `runXxx()` export
2. Create `harnesses/hN-<name>/run.test.ts` using `ScriptedBackend` + `ScriptedBoard`
3. Re-export from `harness/index.ts`
4. Add a section to this README
5. Use the existing primitives — `guard()`, `runVerify()`, `errorHash()`, `repeatStop()`, `writeReceipt()` — rather than reimplementing them

### Project structure conventions

- `harness/` is the shared library (imported by every harness)
- `harnesses/hN-*/` are runnable coordinators
- `fixtures/` hold test repos and data
- `docs/` are reference documents, not generated
- Live backends (`cursor-cloud.ts`, `cursor-cli.ts`) are `@live-only` — no tests; they need real credentials

---

## License

MIT
