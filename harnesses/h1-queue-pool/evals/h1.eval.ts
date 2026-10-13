/**
 * H1 queue-pool eval — exercises the coordinator with the ScriptedBackend.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPool, type PoolConfig } from "../run.js";
import { ScriptedBackend, type ScriptedRunConfig } from "../../../harness/backends/scripted.js";
import { ScriptedBoard } from "../../../harness/board-scripted.js";
import type { TaskItem } from "../../../harness/board.js";
import type { VerifyResult } from "../../../harness/gate.js";

vi.mock("../../../harness/gate.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runVerify: vi.fn() };
});

vi.mock("../../../harness/receipt.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, writeReceipt: vi.fn().mockResolvedValue(undefined) };
});

import { runVerify } from "../../../harness/gate.js";
import { writeReceipt } from "../../../harness/receipt.js";

const mockRunVerify = vi.mocked(runVerify);
const mockWriteReceipt = vi.mocked(writeReceipt);

const PROJECT = "eval-project";

function makeTasks(count: number): TaskItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `FEAT-${String(i + 1).padStart(3, "0")}`,
    title: `Task ${i + 1}`,
    project: PROJECT,
  }));
}

function makeRunConfigs(count: number): ScriptedRunConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    agentId: `agent-${i + 1}`,
    events: [
      { type: "pr_created" as const, data: { url: `https://github.com/org/repo/pull/${i + 1}` } },
      { type: "checks_complete" as const, data: { build: "success" } },
      { type: "run_finished" as const, data: {} },
    ],
    tokens: 1000 * (i + 1),
  }));
}

function makeConfig(overrides?: Partial<PoolConfig>): PoolConfig {
  return {
    poolId: "eval-pool",
    project: PROJECT,
    cap: 7,
    spend: {
      model: "test-model",
      maxSends: 50,
      runTimeoutMs: 600_000,
      maxTotalTokens: 500_000,
      wallMs: 1_200_000,
    },
    verify: ["echo ok"],
    receiptPath: "/tmp/eval-receipt.json",
    ...overrides,
  };
}

function verifyPass(): VerifyResult[] {
  return [{ command: "echo ok", exitCode: 0, output: "ok\n" }];
}

describe("H1 queue-pool coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enforces the Rule of 3: fewer than 3 tasks throw", async () => {
    const board = new ScriptedBoard(makeTasks(2));
    const backend = new ScriptedBackend([]);
    mockRunVerify.mockResolvedValue(verifyPass());

    await expect(
      runPool(makeConfig(), backend, board),
    ).rejects.toThrow(/Rule of 3/);
  });

  it("processes tasks up to the cap", async () => {
    const board = new ScriptedBoard(makeTasks(5));
    const backend = new ScriptedBackend(makeRunConfigs(5));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(makeConfig({ cap: 3 }), backend, board);

    // All 5 tasks processed (3 initially, then refills as seats free)
    expect(receipt.summary.completed).toBe(5);

    // First batch of claims should be 3 (cap), before any complete calls
    const callMethods = board.callLog.map((c) => c.method);
    const firstCompleteIdx = callMethods.indexOf("complete");
    const claimsBefore = callMethods
      .slice(0, firstCompleteIdx)
      .filter((m) => m === "claim").length;
    expect(claimsBefore).toBe(3);
  });

  it("writes a valid receipt file", async () => {
    const board = new ScriptedBoard(makeTasks(4));
    const backend = new ScriptedBackend(makeRunConfigs(4));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(makeConfig(), backend, board);

    expect(mockWriteReceipt).toHaveBeenCalledOnce();
    const written = mockWriteReceipt.mock.calls[0][0];
    expect(written.harness).toBe("h1-queue-pool");
    expect(written.poolId).toBe("eval-pool");
    expect(written.summary).toBeDefined();
    expect(written.summary.completed).toBe(4);
    expect(receipt).toEqual(written);
  });

  it("cancels runs that exceed spend caps", async () => {
    const board = new ScriptedBoard(makeTasks(3));
    const backend = new ScriptedBackend(
      makeRunConfigs(3).map((c) => ({ ...c, tokens: 999_999 })),
    );
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPool(
      makeConfig({
        spend: {
          model: "test-model",
          maxSends: 50,
          runTimeoutMs: 600_000,
          maxTotalTokens: 100_000,
          wallMs: 1_200_000,
        },
      }),
      backend,
      board,
    );

    const cancelled = receipt.seats.filter((s) => s.status === "cancelled");
    expect(cancelled.length).toBeGreaterThan(0);
    expect(cancelled[0].trippedLock).toBe("maxTotalTokens");
  });
});
