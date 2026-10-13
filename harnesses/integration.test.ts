/**
 * Integration tests — exercises harnesses working together with
 * shared ScriptedBackend, ScriptedBoard, and spend tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ScriptedBackend,
  type ScriptedRunConfig,
} from "../harness/backends/scripted.js";
import { ScriptedBoard } from "../harness/board-scripted.js";
import type { TaskItem } from "../harness/board.js";
import type { VerifyResult } from "../harness/gate.js";
import type { SpendConfig } from "../harness/spend.js";
import { guard } from "../harness/spend.js";
import { summarize, type SeatResult } from "../harness/receipt.js";
import { runPool, type PoolConfig } from "./h1-queue-pool/run.js";
import {
  runPipeline,
  type PipelineConfig,
  type PipelineStage,
} from "./h3-pipeline-gates/run.js";
import {
  runTournament,
  scorers,
  type TournamentConfig,
} from "./h4-best-of-n/run.js";
import {
  runRouter,
  classifiers,
  type RouterConfig,
  type TierConfig,
} from "./h5-router-tiers/run.js";
import { Patrol, type PatrolConfig, type StallAction } from "./h7-patrol/run.js";

/* ─── Mocks ─── */

vi.mock("../harness/gate.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runVerify: vi.fn(),
    filesAllowlist: vi.fn().mockReturnValue({ violations: [] }),
  };
});

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

import { runVerify } from "../harness/gate.js";

const mockRunVerify = vi.mocked(runVerify);

/* ─── Shared helpers ─── */

const PROJECT = "integration-project";

function makeTasks(count: number): TaskItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `itask-${i + 1}`,
    title: `Integration Task ${i + 1}`,
    project: PROJECT,
  }));
}

function makeRunConfigs(count: number, tokensPerRun = 1000): ScriptedRunConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    agentId: `int-agent-${i + 1}`,
    events: [{ type: "run_finished" as const, data: {} }],
    tokens: tokensPerRun * (i + 1),
  }));
}

function makeSpend(overrides?: Partial<SpendConfig>): SpendConfig {
  return {
    model: "integration-model",
    maxSends: 100,
    runTimeoutMs: 120_000,
    maxTotalTokens: 1_000_000,
    wallMs: 120_000,
    ...overrides,
  };
}

function verifyPass(): VerifyResult[] {
  return [{ command: "echo ok", exitCode: 0, output: "ok\n" }];
}

function verifyFail(output = "error: integration fail"): VerifyResult[] {
  return [{ command: "echo ok", exitCode: 1, output }];
}

/* ─── Tests ─── */

beforeEach(() => {
  vi.clearAllMocks();
});

describe("H1 pool with ScriptedBackend and ScriptedBoard", () => {
  it("runs 3 tasks through a pool and all complete", async () => {
    const tasks = makeTasks(3);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const config: PoolConfig = {
      poolId: "int-pool-1",
      project: PROJECT,
      cap: 3,
      spend: makeSpend(),
      verify: ["echo ok"],
    };

    const receipt = await runPool(config, backend, board);

    expect(receipt.summary.completed).toBe(3);
    expect(receipt.summary.blocked).toBe(0);
    expect(receipt.summary.cancelled).toBe(0);
    expect(receipt.seats).toHaveLength(3);
    expect(board.tasks).toHaveLength(0);

    const claims = board.callLog.filter((c) => c.method === "claim");
    expect(claims).toHaveLength(3);

    const completes = board.callLog.filter((c) => c.method === "complete");
    expect(completes).toHaveLength(3);
  });

  it("board tracks lifecycle calls in correct order", async () => {
    const tasks = makeTasks(4);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(4));
    mockRunVerify.mockResolvedValue(verifyPass());

    const config: PoolConfig = {
      poolId: "int-pool-lifecycle",
      project: PROJECT,
      cap: 2,
      spend: makeSpend(),
      verify: ["echo ok"],
    };

    const receipt = await runPool(config, backend, board);

    expect(receipt.summary.completed).toBe(4);

    const methods = board.callLog.map((c) => c.method);
    expect(methods[0]).toBe("listOpen");

    const firstComplete = methods.indexOf("complete");
    const claimsBefore = methods.slice(0, firstComplete).filter((m) => m === "claim").length;
    expect(claimsBefore).toBe(2);

    expect(methods.filter((m) => m === "appendDaily")).toHaveLength(1);
  });
});

describe("H3 pipeline with stage gates", () => {
  it("runs 2-stage pipeline and both pass", async () => {
    const stages: PipelineStage[] = [
      { name: "plan", prompt: "Plan {task}", verify: ["echo ok"] },
      { name: "implement", prompt: "Implement {task}", verify: ["echo ok"] },
    ];
    const backend = new ScriptedBackend(makeRunConfigs(2));
    mockRunVerify.mockResolvedValue(verifyPass());

    const config: PipelineConfig = {
      pipelineId: "int-pipeline-1",
      task: "add integration feature",
      stages,
      spend: makeSpend(),
    };

    const receipt = await runPipeline(config, backend);

    expect(receipt.finalStatus).toBe("success");
    expect(receipt.stages).toHaveLength(2);
    expect(receipt.stages[0].status).toBe("success");
    expect(receipt.stages[0].stage).toBe("plan");
    expect(receipt.stages[1].status).toBe("success");
    expect(receipt.stages[1].stage).toBe("implement");
    expect(receipt.totalTokens).toBe(1000 + 2000);
  });

  it("gate blocks second stage when first fails", async () => {
    const stages: PipelineStage[] = [
      { name: "plan", prompt: "Plan {task}", verify: ["echo ok"] },
      { name: "implement", prompt: "Implement {task}", verify: ["echo ok"] },
    ];
    const backend = new ScriptedBackend(makeRunConfigs(2));
    mockRunVerify
      .mockResolvedValueOnce(verifyFail())
      .mockResolvedValue(verifyPass());

    const receipt = await runPipeline(
      { pipelineId: "int-pipeline-gate", task: "blocked task", stages, spend: makeSpend() },
      backend,
    );

    expect(receipt.finalStatus).toBe("failed");
    expect(receipt.stages[0].status).toBe("failed");
    expect(receipt.stages[1].status).toBe("skipped");

    const creates = backend.callLog.filter((c) => c.method === "create");
    expect(creates).toHaveLength(1);
  });

  it("pipeline prompt substitution works across stages", async () => {
    const stages: PipelineStage[] = [
      { name: "s1", prompt: "Step 1: {task}", verify: ["echo ok"] },
      { name: "s2", prompt: "Step 2: {task}", verify: ["echo ok"] },
    ];
    const backend = new ScriptedBackend(makeRunConfigs(2));
    mockRunVerify.mockResolvedValue(verifyPass());

    await runPipeline(
      { pipelineId: "int-pipeline-sub", task: "refactor auth", stages, spend: makeSpend() },
      backend,
    );

    const creates = backend.callLog.filter((c) => c.method === "create");
    expect((creates[0].args[0] as Record<string, unknown>).prompt).toBe("Step 1: refactor auth");
    expect((creates[1].args[0] as Record<string, unknown>).prompt).toBe("Step 2: refactor auth");
  });
});

describe("H4 tournament with multiple runners", () => {
  it("runs 2 contestants and picks the winner", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(2, 500));
    mockRunVerify.mockResolvedValue(verifyPass());

    let idx = 0;
    const config: TournamentConfig = {
      tournamentId: "int-tournament-1",
      task: "sort algorithm",
      n: 2,
      spend: makeSpend(),
      verify: ["echo ok"],
      scorer: async () => [70, 95][idx++],
    };

    const receipt = await runTournament(config, backend);

    expect(receipt.contestants).toHaveLength(2);
    expect(receipt.winnerId).toBe("int-agent-2");
    expect(receipt.winnerScore).toBe(95);

    const winner = receipt.contestants.find((c) => c.status === "winner");
    expect(winner).toBeDefined();
    expect(winner!.agentId).toBe("int-agent-2");

    const passed = receipt.contestants.filter((c) => c.status === "passed");
    expect(passed).toHaveLength(1);
    expect(passed[0].agentId).toBe("int-agent-1");
  });

  it("failed verify contestant cannot win", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(2, 500));
    mockRunVerify
      .mockResolvedValueOnce(verifyFail())
      .mockResolvedValueOnce(verifyPass());

    const config: TournamentConfig = {
      tournamentId: "int-tournament-fail",
      task: "sort algorithm",
      n: 2,
      spend: makeSpend(),
      verify: ["echo ok"],
      scorer: scorers.passOnly,
    };

    const receipt = await runTournament(config, backend);

    const failed = receipt.contestants.find((c) => c.seatIndex === 0);
    expect(failed!.status).toBe("failed");
    expect(failed!.score).toBe(0);

    expect(receipt.winnerId).toBe("int-agent-2");
  });

  it("tie-breaks by token count", async () => {
    const configs: ScriptedRunConfig[] = [
      { agentId: "heavy", events: [{ type: "run_finished", data: {} }], tokens: 5000 },
      { agentId: "light", events: [{ type: "run_finished", data: {} }], tokens: 1000 },
    ];
    const backend = new ScriptedBackend(configs);
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runTournament(
      {
        tournamentId: "int-tournament-tie",
        task: "task",
        n: 2,
        spend: makeSpend(),
        verify: ["echo ok"],
        scorer: scorers.passOnly,
      },
      backend,
    );

    expect(receipt.winnerId).toBe("light");
  });
});

describe("H5 router tier selection", () => {
  it("classifies tasks to correct tiers", async () => {
    const tiers: TierConfig[] = [
      { name: "fast", model: "gpt-fast" },
      { name: "standard", model: "gpt-standard" },
      { name: "premium", model: "gpt-premium" },
    ];
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const classifier = async (task: string) => {
      if (task.includes("simple")) return "fast";
      if (task.includes("medium")) return "standard";
      return "premium";
    };

    const config: RouterConfig = {
      routerId: "int-router-1",
      tiers,
      classifier,
      spend: makeSpend(),
      verify: ["echo ok"],
    };

    const receipt = await runRouter(config, ["simple fix", "medium refactor", "hard migration"], backend);

    expect(receipt.results).toHaveLength(3);
    expect(receipt.results[0].tier).toBe("fast");
    expect(receipt.results[0].status).toBe("success");
    expect(receipt.results[1].tier).toBe("standard");
    expect(receipt.results[1].status).toBe("success");
    expect(receipt.results[2].tier).toBe("premium");
    expect(receipt.results[2].status).toBe("success");

    const createCalls = backend.callLog.filter((c) => c.method === "create");
    expect((createCalls[0].args[0] as Record<string, unknown>).model).toBe("gpt-fast");
    expect((createCalls[1].args[0] as Record<string, unknown>).model).toBe("gpt-standard");
    expect((createCalls[2].args[0] as Record<string, unknown>).model).toBe("gpt-premium");
  });

  it("escalates through tiers on verify failure", async () => {
    const tiers: TierConfig[] = [
      { name: "fast", model: "gpt-fast" },
      { name: "standard", model: "gpt-standard" },
    ];
    const backend = new ScriptedBackend(makeRunConfigs(2));
    mockRunVerify
      .mockResolvedValueOnce(verifyFail())
      .mockResolvedValueOnce(verifyPass());

    const receipt = await runRouter(
      {
        routerId: "int-router-esc",
        tiers,
        classifier: classifiers.alwaysCheap,
        spend: makeSpend(),
        verify: ["echo ok"],
      },
      ["tricky task"],
      backend,
    );

    expect(receipt.results[0].status).toBe("escalated");
    expect(receipt.results[0].tier).toBe("fast");
    expect(receipt.results[0].finalTier).toBe("standard");
    expect(receipt.escalations).toBe(1);
  });

  it("breakdown counts match results", async () => {
    const tiers: TierConfig[] = [
      { name: "fast", model: "gpt-fast" },
      { name: "standard", model: "gpt-standard" },
    ];
    const backend = new ScriptedBackend(makeRunConfigs(4, 500));
    mockRunVerify.mockResolvedValue(verifyPass());

    let idx = 0;
    const classifier = async () => ["fast", "standard", "fast", "standard"][idx++];

    const receipt = await runRouter(
      { routerId: "int-router-bd", tiers, classifier, spend: makeSpend(), verify: ["echo ok"] },
      ["t1", "t2", "t3", "t4"],
      backend,
    );

    expect(receipt.tierBreakdown.fast.count).toBe(2);
    expect(receipt.tierBreakdown.fast.successes).toBe(2);
    expect(receipt.tierBreakdown.standard.count).toBe(2);
    expect(receipt.tierBreakdown.standard.successes).toBe(2);
    expect(receipt.totalTokens).toBe(500 + 1000 + 1500 + 2000);
  });
});

describe("H7 patrol stall detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers agent and detects stall", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol({
      patrolId: "int-patrol-1",
      pollIntervalMs: 1000,
      stallThresholdMs: 3000,
      maxNudges: 2,
      onStall,
    });

    patrol.watch("int-agent-1");

    vi.advanceTimersByTime(4000);
    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(1);
    expect(stalled[0].agentId).toBe("int-agent-1");
    expect(onStall).toHaveBeenCalledWith("int-agent-1", expect.any(Number), 0);
  });

  it("heartbeat prevents stall detection", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol({
      patrolId: "int-patrol-hb",
      pollIntervalMs: 1000,
      stallThresholdMs: 3000,
      maxNudges: 2,
      onStall,
    });

    patrol.watch("int-agent-1");

    vi.advanceTimersByTime(2000);
    patrol.heartbeat("int-agent-1");
    vi.advanceTimersByTime(2000);

    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(0);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("auto-cancels after maxNudges", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol({
      patrolId: "int-patrol-max",
      pollIntervalMs: 1000,
      stallThresholdMs: 1000,
      maxNudges: 1,
      onStall,
    });

    patrol.watch("int-agent-1");

    vi.advanceTimersByTime(2000);
    await patrol.tick();
    expect(onStall).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(1);
    expect(stalled[0].status).toBe("cancelled");
  });

  it("report includes all registered agents", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol({
      patrolId: "int-patrol-report",
      pollIntervalMs: 1000,
      stallThresholdMs: 5000,
      maxNudges: 2,
      onStall,
    });

    patrol.watch("agent-a");
    patrol.watch("agent-b");
    patrol.complete("agent-b");

    const report = patrol.stop();

    expect(report.patrolId).toBe("int-patrol-report");
    expect(report.agents).toHaveLength(2);
    expect(report.agents.find((a) => a.agentId === "agent-a")!.status).toBe("active");
    expect(report.agents.find((a) => a.agentId === "agent-b")!.status).toBe("completed");
  });
});

describe("SpendLedger — spend guard across multiple harness runs", () => {
  it("guard does not trip when under caps", async () => {
    const run = { usage: { totalTokens: 500 }, cancel: vi.fn() };
    const config = makeSpend({ maxTotalTokens: 10_000 });

    const result = await guard(run, config, Date.now(), 1);

    expect(result.tripped).toBe(false);
    expect(result.lockName).toBeNull();
    expect(run.cancel).not.toHaveBeenCalled();
  });

  it("tracks cumulative tokens across pool + pipeline + tournament", async () => {
    mockRunVerify.mockResolvedValue(verifyPass());

    const poolTasks = makeTasks(3);
    const board = new ScriptedBoard(poolTasks);
    const poolBackend = new ScriptedBackend(makeRunConfigs(3, 200));
    const poolReceipt = await runPool(
      { poolId: "spend-pool", project: PROJECT, cap: 3, spend: makeSpend(), verify: ["echo ok"] },
      poolBackend,
      board,
    );

    const pipeBackend = new ScriptedBackend(makeRunConfigs(2, 300));
    const pipeReceipt = await runPipeline(
      {
        pipelineId: "spend-pipe",
        task: "add feature",
        stages: [
          { name: "plan", prompt: "Plan {task}", verify: ["echo ok"] },
          { name: "code", prompt: "Code {task}", verify: ["echo ok"] },
        ],
        spend: makeSpend(),
      },
      pipeBackend,
    );

    const tournBackend = new ScriptedBackend(makeRunConfigs(2, 400));
    const tournReceipt = await runTournament(
      {
        tournamentId: "spend-tourn",
        task: "optimize query",
        n: 2,
        spend: makeSpend(),
        verify: ["echo ok"],
        scorer: scorers.passOnly,
      },
      tournBackend,
    );

    const cumulativeTokens =
      poolReceipt.summary.totalTokens +
      pipeReceipt.totalTokens +
      tournReceipt.totalTokens;

    expect(cumulativeTokens).toBeGreaterThan(0);

    const fakeRun = { usage: { totalTokens: cumulativeTokens }, cancel: vi.fn() };
    const tightConfig = makeSpend({ maxTotalTokens: cumulativeTokens - 1 });
    const result = await guard(fakeRun, tightConfig, Date.now(), 0);

    expect(result.tripped).toBe(true);
    expect(result.lockName).toBe("maxTotalTokens");
    expect(fakeRun.cancel).toHaveBeenCalledOnce();
  });

  it("guard trips wallBudget when elapsed exceeds limit", async () => {
    const run = { usage: { totalTokens: 100 }, cancel: vi.fn() };
    const config = makeSpend({ wallMs: 5000 });
    const oldStart = Date.now() - 10_000;

    const result = await guard(run, config, oldStart, 0);

    expect(result.tripped).toBe(true);
    expect(result.lockName).toBe("wallBudget");
  });

  it("accumulates tokens correctly via summarize", () => {
    const seats: SeatResult[] = [
      { task: "t1", agentId: "a1", model: "m", status: "completed", pr: null, checks: {}, tokens: 1000, trippedLock: null, blockedReason: null },
      { task: "t2", agentId: "a2", model: "m", status: "completed", pr: null, checks: {}, tokens: 2500, trippedLock: null, blockedReason: null },
      { task: "t3", agentId: "a3", model: "m", status: "blocked", pr: null, checks: {}, tokens: 500, trippedLock: null, blockedReason: "err" },
    ];

    const summary = summarize(seats);

    expect(summary.completed).toBe(2);
    expect(summary.blocked).toBe(1);
    expect(summary.cancelled).toBe(0);
    expect(summary.totalTokens).toBe(4000);
  });
});

describe("cross-harness: pool feeds pipeline", () => {
  it("pool receipt informs pipeline task selection", async () => {
    mockRunVerify.mockResolvedValue(verifyPass());

    const tasks = makeTasks(3);
    const board = new ScriptedBoard(tasks);
    const poolBackend = new ScriptedBackend(makeRunConfigs(3));
    const poolReceipt = await runPool(
      { poolId: "cross-pool", project: PROJECT, cap: 3, spend: makeSpend(), verify: ["echo ok"] },
      poolBackend,
      board,
    );

    expect(poolReceipt.summary.completed).toBe(3);

    const pipelineTask = `Follow-up for pool ${poolReceipt.poolId} (${poolReceipt.summary.completed} completed)`;
    const pipeBackend = new ScriptedBackend(makeRunConfigs(2));
    const pipeReceipt = await runPipeline(
      {
        pipelineId: "cross-pipe",
        task: pipelineTask,
        stages: [
          { name: "review", prompt: "Review {task}", verify: ["echo ok"] },
          { name: "deploy", prompt: "Deploy {task}", verify: ["echo ok"] },
        ],
        spend: makeSpend(),
      },
      pipeBackend,
    );

    expect(pipeReceipt.finalStatus).toBe("success");
    expect(pipeReceipt.task).toContain("cross-pool");
    expect(pipeReceipt.task).toContain("3 completed");
  });
});

describe("cross-harness: router + tournament", () => {
  it("router result feeds tournament for premium-tier tasks", async () => {
    mockRunVerify.mockResolvedValue(verifyPass());

    const tiers: TierConfig[] = [
      { name: "fast", model: "gpt-fast" },
      { name: "premium", model: "gpt-premium" },
    ];
    const routerBackend = new ScriptedBackend(makeRunConfigs(1));
    const routerReceipt = await runRouter(
      {
        routerId: "cross-router",
        tiers,
        classifier: async () => "premium",
        spend: makeSpend(),
        verify: ["echo ok"],
      },
      ["critical migration"],
      routerBackend,
    );

    expect(routerReceipt.results[0].tier).toBe("premium");

    const tournBackend = new ScriptedBackend(makeRunConfigs(2, 500));
    let idx = 0;
    const tournReceipt = await runTournament(
      {
        tournamentId: "cross-tourn",
        task: routerReceipt.results[0].task,
        n: 2,
        spend: makeSpend(),
        verify: ["echo ok"],
        scorer: async () => [80, 60][idx++],
      },
      tournBackend,
    );

    expect(tournReceipt.task).toBe("critical migration");
    expect(tournReceipt.winnerId).toBe("int-agent-1");
    expect(tournReceipt.winnerScore).toBe(80);
  });
});

describe("cross-harness: patrol monitors pool agents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("patrol watches agents from a pool-like scenario", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol({
      patrolId: "cross-patrol",
      pollIntervalMs: 1000,
      stallThresholdMs: 2000,
      maxNudges: 2,
      onStall,
    });

    patrol.watch("pool-agent-1");
    patrol.watch("pool-agent-2");
    patrol.watch("pool-agent-3");

    vi.advanceTimersByTime(1500);
    patrol.heartbeat("pool-agent-1");
    patrol.heartbeat("pool-agent-2");

    vi.advanceTimersByTime(1500);

    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(1);
    expect(stalled[0].agentId).toBe("pool-agent-3");

    patrol.complete("pool-agent-1");
    patrol.complete("pool-agent-2");
    patrol.heartbeat("pool-agent-3");

    vi.advanceTimersByTime(3000);
    const stalled2 = await patrol.tick();

    expect(stalled2).toHaveLength(1);
    expect(stalled2[0].agentId).toBe("pool-agent-3");

    const report = patrol.stop();
    expect(report.agents).toHaveLength(3);
    expect(report.totalCancelled).toBe(0);
  });
});
