import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ScriptedBackend,
  type ScriptedRunConfig,
} from "../../harness/backends/scripted.js";
import { ScriptedBoard } from "../../harness/board-scripted.js";
import type { TaskItem } from "../../harness/board.js";
import type { VerifyResult } from "../../harness/gate.js";
import type { SpendConfig } from "../../harness/spend.js";
import { runPool, type PoolConfig } from "./run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ─── Mocks ─── */

vi.mock("../../harness/gate.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runVerify: vi.fn() };
});

vi.mock("../../harness/receipt.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, writeReceipt: vi.fn().mockResolvedValue(undefined) };
});

import { runVerify } from "../../harness/gate.js";
import { writeReceipt } from "../../harness/receipt.js";

const mockRunVerify = vi.mocked(runVerify);
const mockWriteReceipt = vi.mocked(writeReceipt);

/* ─── Helpers ─── */

const PROJECT = "test-project";

function makeTasks(count: number): TaskItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    title: `Task ${i + 1}`,
    project: PROJECT,
  }));
}

function makeRunConfigs(count: number): ScriptedRunConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    agentId: `agent-${i + 1}`,
    events: [{ type: "run_finished" as const, data: {} }],
    tokens: 1000 * (i + 1),
  }));
}

function makeSpend(overrides?: Partial<SpendConfig>): SpendConfig {
  return {
    model: "test-model",
    maxSends: 100,
    runTimeoutMs: 60_000,
    maxTotalTokens: 1_000_000,
    wallMs: 60_000,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<PoolConfig>): PoolConfig {
  return {
    poolId: "test-pool",
    project: PROJECT,
    cap: 7,
    spend: makeSpend(),
    verify: ["echo ok"],
    receiptPath: "/tmp/test-receipt.json",
    ...overrides,
  };
}

function verifyPass(): VerifyResult[] {
  return [{ command: "echo ok", exitCode: 0, output: "ok\n" }];
}

function verifyFail(output = "error: something broke"): VerifyResult[] {
  return [{ command: "echo ok", exitCode: 1, output }];
}

/* ─── Tests ─── */

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runPool", () => {
  it("completes all tasks with passing verify", async () => {
    const tasks = makeTasks(4);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(4));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(makeConfig(), backend, board);

    expect(receipt.summary.completed).toBe(4);
    expect(receipt.summary.blocked).toBe(0);
    expect(receipt.summary.cancelled).toBe(0);
    expect(receipt.seats).toHaveLength(4);
    for (const s of receipt.seats) {
      expect(s.status).toBe("completed");
    }
  });

  it("blocks task after repeat error", async () => {
    // 4 tasks, first two fail with identical output → repeat-stop on second
    const tasks = makeTasks(4);
    const board = new ScriptedBoard(tasks);
    // 4 initial + 1 retry for first task = 5 configs needed
    const backend = new ScriptedBackend(makeRunConfigs(5));

    mockRunVerify
      .mockResolvedValueOnce(verifyFail("same error"))   // task 1 attempt 1
      .mockResolvedValueOnce(verifyFail("same error"))   // task 2 → repeat-stop
      .mockResolvedValue(verifyPass());                   // task 3, task 4, task 1 retry

    const receipt = await runPool(makeConfig(), backend, board);

    const blockedSeats = receipt.seats.filter((s) => s.status === "blocked");
    expect(blockedSeats.length).toBeGreaterThanOrEqual(1);
    expect(
      blockedSeats.some((s) => s.blockedReason?.includes("Repeat-stop")),
    ).toBe(true);

    // task 2 should be the one blocked by repeat-stop
    const task2Seat = receipt.seats.find((s) => s.task === "task-2");
    expect(task2Seat?.status).toBe("blocked");
    expect(task2Seat?.blockedReason).toContain("Repeat-stop");
  });

  it("retries once on first failure", async () => {
    const tasks = makeTasks(4);
    const board = new ScriptedBoard(tasks);
    // 4 initial + 1 retry = 5 configs
    const backend = new ScriptedBackend(makeRunConfigs(5));

    mockRunVerify
      .mockResolvedValueOnce(verifyFail("unique error A")) // task 1 attempt 1 → retry
      .mockResolvedValue(verifyPass());                     // task 2-4, task 1 retry

    const receipt = await runPool(makeConfig(), backend, board);

    // Task 1 was retried and succeeded on second attempt
    expect(receipt.summary.completed).toBe(4);
    expect(receipt.summary.blocked).toBe(0);

    // Backend should have been called 5 times (4 initial + 1 retry)
    expect(backend.callLog.filter((c) => c.method === "create")).toHaveLength(5);
  });

  it("throws on fewer than 3 tasks (Rule of 3)", async () => {
    const tasks = makeTasks(2);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(2));
    mockRunVerify.mockResolvedValue(verifyPass());

    await expect(runPool(makeConfig(), backend, board)).rejects.toThrow(
      /Rule of 3/,
    );

    // No backend calls should have been made
    expect(backend.callLog).toHaveLength(0);
  });

  it("throws on zero tasks", async () => {
    const board = new ScriptedBoard([]);
    const backend = new ScriptedBackend([]);
    mockRunVerify.mockResolvedValue(verifyPass());

    await expect(runPool(makeConfig(), backend, board)).rejects.toThrow(
      /Rule of 3.*0 task/,
    );
  });

  it("respects cap limit", async () => {
    const tasks = makeTasks(5);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(5));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(makeConfig({ cap: 3 }), backend, board);

    expect(receipt.summary.completed).toBe(5);

    // Verify claim order: first 3 claimed up front, then 2 more as seats freed
    const claims = board.callLog.filter((c) => c.method === "claim");
    expect(claims).toHaveLength(5);

    // The first 3 claims happen before any complete call
    const callMethods = board.callLog.map((c) => c.method);
    const firstCompleteIdx = callMethods.indexOf("complete");
    const claimsBefore = callMethods
      .slice(0, firstCompleteIdx)
      .filter((m) => m === "claim").length;
    expect(claimsBefore).toBe(3);
  });

  it("writes receipt with correct counts", async () => {
    const tasks = makeTasks(4);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(4));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(
      makeConfig({ receiptPath: "/tmp/h1-receipt.json" }),
      backend,
      board,
    );

    expect(mockWriteReceipt).toHaveBeenCalledOnce();
    const writtenReceipt = mockWriteReceipt.mock.calls[0][0];
    expect(writtenReceipt.poolId).toBe("test-pool");
    expect(writtenReceipt.harness).toBe("h1-queue-pool");
    expect(writtenReceipt.summary.completed).toBe(4);
    expect(writtenReceipt.summary.totalTokens).toBeGreaterThan(0);
    expect(mockWriteReceipt.mock.calls[0][1]).toBe("/tmp/h1-receipt.json");

    // Receipt matches return value
    expect(receipt).toEqual(writtenReceipt);
  });

  it("skips writeReceipt when receiptPath is omitted", async () => {
    const tasks = makeTasks(3);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    await runPool(makeConfig({ receiptPath: undefined }), backend, board);

    expect(mockWriteReceipt).not.toHaveBeenCalled();
  });

  it("appends daily summary", async () => {
    const tasks = makeTasks(4);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(4));
    mockRunVerify.mockResolvedValue(verifyPass());

    await runPool(makeConfig(), backend, board);

    const dailyCalls = board.callLog.filter((c) => c.method === "appendDaily");
    expect(dailyCalls).toHaveLength(1);
    expect(dailyCalls[0].args[0]).toBe("H1 pool");

    const summaryText = dailyCalls[0].args[1] as string;
    expect(summaryText).toContain("test-pool");
    expect(summaryText).toContain("4 completed");
    expect(summaryText).toContain("0 blocked");
    expect(summaryText).toContain("0 cancelled");
    expect(summaryText).toContain("tokens");
  });

  it("stops when board is empty", async () => {
    // Exactly 3 tasks (minimum), all complete
    const tasks = makeTasks(3);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(makeConfig({ cap: 10 }), backend, board);

    expect(receipt.summary.completed).toBe(3);
    expect(receipt.seats).toHaveLength(3);

    // Board should be drained: all tasks claimed
    expect(board.tasks).toHaveLength(0);
  });

  it("blocks after retry when verify keeps failing", async () => {
    const tasks = makeTasks(3);
    const board = new ScriptedBoard(tasks);
    // 3 initial + 1 retry = 4 configs
    const backend = new ScriptedBackend(makeRunConfigs(4));

    // Task 1 fails with unique error A, retried, fails with unique error B → blocked after retry
    // Tasks 2 and 3 pass
    mockRunVerify
      .mockResolvedValueOnce(verifyFail("unique error A"))  // task 1 attempt 1
      .mockResolvedValueOnce(verifyPass())                   // task 2
      .mockResolvedValueOnce(verifyPass())                   // task 3
      .mockResolvedValueOnce(verifyFail("unique error B"));  // task 1 retry

    const receipt = await runPool(makeConfig(), backend, board);

    expect(receipt.summary.completed).toBe(2);
    expect(receipt.summary.blocked).toBe(1);

    const blockedSeat = receipt.seats.find((s) => s.status === "blocked");
    expect(blockedSeat?.task).toBe("task-1");
    expect(blockedSeat?.blockedReason).toContain("Verify failed after retry");
  });

  it("includes correct agentId from ScriptedRun in seats", async () => {
    const tasks = makeTasks(3);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(makeConfig(), backend, board);

    expect(receipt.seats[0].agentId).toBe("agent-1");
    expect(receipt.seats[1].agentId).toBe("agent-2");
    expect(receipt.seats[2].agentId).toBe("agent-3");
  });

  it("uses config.model when provided", async () => {
    const tasks = makeTasks(3);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(
      makeConfig({ model: "claude-4-opus" }),
      backend,
      board,
    );

    for (const s of receipt.seats) {
      expect(s.model).toBe("claude-4-opus");
    }

    const createCall = backend.callLog.find((c) => c.method === "create");
    expect((createCall?.args[0] as Record<string, unknown>).model).toBe(
      "claude-4-opus",
    );
  });

  it("falls back to spend.model when config.model is omitted", async () => {
    const tasks = makeTasks(3);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(
      makeConfig({ model: undefined }),
      backend,
      board,
    );

    for (const s of receipt.seats) {
      expect(s.model).toBe("test-model");
    }
  });

  it("returns receipt with correct timestamps and metadata", async () => {
    const tasks = makeTasks(3);
    const board = new ScriptedBoard(tasks);
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const before = new Date().toISOString();
    const receipt = await runPool(makeConfig({ cap: 5 }), backend, board);
    const after = new Date().toISOString();

    expect(receipt.poolId).toBe("test-pool");
    expect(receipt.harness).toBe("h1-queue-pool");
    expect(receipt.cap).toBe(5);
    expect(receipt.started >= before).toBe(true);
    expect(receipt.finished <= after).toBe(true);
    expect(receipt.started <= receipt.finished).toBe(true);
  });
});

describe("pool-target fixture", () => {
  it("cases.json has >= 3 entries (Rule of 3 compatible)", () => {
    const casesPath = resolve(__dirname, "../../fixtures/pool-target/cases.json");
    const cases = JSON.parse(readFileSync(casesPath, "utf-8")) as Array<{
      id: string;
      text: string;
    }>;
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const c of cases) {
      expect(c.id).toBeTruthy();
      expect(c.text).toBeTruthy();
    }
  });
});
