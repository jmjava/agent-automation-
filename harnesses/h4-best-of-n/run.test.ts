import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ScriptedBackend,
  type ScriptedRunConfig,
} from "../../harness/backends/scripted.js";
import type { VerifyResult } from "../../harness/gate.js";
import type { SpendConfig } from "../../harness/spend.js";
import {
  runTournament,
  scorers,
  type TournamentConfig,
  type Scorer,
} from "./run.js";

/* ─── Mocks ─── */

vi.mock("../../harness/gate.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runVerify: vi.fn(),
  };
});

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

import { runVerify } from "../../harness/gate.js";
import { writeFile, rename } from "node:fs/promises";

const mockRunVerify = vi.mocked(runVerify);
const mockWriteFile = vi.mocked(writeFile);
const mockRename = vi.mocked(rename);

/* ─── Helpers ─── */

function makeRunConfigs(count: number, tokensFn?: (i: number) => number): ScriptedRunConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    agentId: `contestant-${i}`,
    events: [{ type: "run_finished" as const, data: {} }],
    tokens: tokensFn ? tokensFn(i) : 1000 * (i + 1),
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

function makeConfig(overrides?: Partial<TournamentConfig>): TournamentConfig {
  return {
    tournamentId: "test-tournament",
    task: "implement sorting algorithm",
    n: 3,
    spend: makeSpend(),
    verify: ["npm test"],
    scorer: scorers.passOnly,
    ...overrides,
  };
}

function verifyPass(): VerifyResult[] {
  return [{ command: "npm test", exitCode: 0, output: "ok\n" }];
}

function verifyFail(): VerifyResult[] {
  return [{ command: "npm test", exitCode: 1, output: "error: tests failed" }];
}

/* ─── Tests ─── */

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTournament", () => {
  it("tournament picks highest-scoring contestant", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    let callIndex = 0;
    const customScorer: Scorer = async () => {
      const scores = [60, 90, 70];
      return scores[callIndex++];
    };

    const receipt = await runTournament(
      makeConfig({ scorer: customScorer }),
      backend,
    );

    expect(receipt.winnerId).toBe("contestant-1");
    expect(receipt.winnerScore).toBe(90);

    const winner = receipt.contestants.find((c) => c.status === "winner");
    expect(winner).toBeDefined();
    expect(winner!.agentId).toBe("contestant-1");
    expect(winner!.score).toBe(90);

    const passed = receipt.contestants.filter((c) => c.status === "passed");
    expect(passed).toHaveLength(2);
  });

  it("tournament marks failed verify as score 0", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify
      .mockResolvedValueOnce(verifyPass())
      .mockResolvedValueOnce(verifyFail())
      .mockResolvedValueOnce(verifyPass());

    const receipt = await runTournament(makeConfig(), backend);

    const failed = receipt.contestants.find((c) => c.seatIndex === 1);
    expect(failed).toBeDefined();
    expect(failed!.status).toBe("failed");
    expect(failed!.score).toBe(0);
    expect(failed!.verifyPassed).toBe(false);
  });

  it("tournament breaks ties by token count", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(3, (i) => {
      return [3000, 1000, 2000][i];
    }));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runTournament(
      makeConfig({ scorer: scorers.passOnly }),
      backend,
    );

    expect(receipt.winnerId).toBe("contestant-1");
    expect(receipt.contestants.find((c) => c.agentId === "contestant-1")!.status).toBe("winner");
  });

  it("tournament works with n=1", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(1));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runTournament(
      makeConfig({ n: 1 }),
      backend,
    );

    expect(receipt.n).toBe(1);
    expect(receipt.contestants).toHaveLength(1);
    expect(receipt.contestants[0].status).toBe("winner");
    expect(receipt.winnerId).toBe("contestant-0");
  });

  it("tournament handles all failures (no winner)", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyFail());

    const receipt = await runTournament(makeConfig(), backend);

    expect(receipt.winnerId).toBe("");
    expect(receipt.winnerScore).toBe(0);
    expect(receipt.contestants.every((c) => c.status === "failed")).toBe(true);
    expect(receipt.contestants.every((c) => c.score === 0)).toBe(true);
  });

  it("tournament runs n agents in parallel", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    await runTournament(makeConfig(), backend);

    const createCalls = backend.callLog.filter((c) => c.method === "create");
    expect(createCalls).toHaveLength(3);

    for (const call of createCalls) {
      const opts = call.args[0] as Record<string, unknown>;
      expect(opts.prompt).toBe("implement sorting algorithm");
      const meta = opts.metadata as Record<string, string>;
      expect(meta.tournament).toBe("test-tournament");
    }
  });

  it("tournament writes receipt with correct counts", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runTournament(
      makeConfig({ receiptPath: "/tmp/h4-receipt.json" }),
      backend,
    );

    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockRename).toHaveBeenCalledOnce();

    const writtenJson = mockWriteFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenJson);
    expect(parsed.tournamentId).toBe(receipt.tournamentId);
    expect(parsed.n).toBe(3);
    expect(parsed.contestants).toHaveLength(3);
    expect(parsed.totalTokens).toBe(receipt.totalTokens);

    expect(mockRename.mock.calls[0][1]).toBe("/tmp/h4-receipt.json");
  });
});

describe("scorers", () => {
  it("passOnly scorer gives 50 to all", async () => {
    const mockRun = { usage: { totalTokens: 5000 }, cancel: vi.fn() };
    const score = await scorers.passOnly(mockRun);
    expect(score).toBe(50);
  });

  it("tokenEfficiency scorer rewards fewer tokens", async () => {
    const lowRun = { usage: { totalTokens: 500 }, cancel: vi.fn() };
    const highRun = { usage: { totalTokens: 8000 }, cancel: vi.fn() };

    const lowScore = await scorers.tokenEfficiency(lowRun);
    const highScore = await scorers.tokenEfficiency(highRun);

    expect(lowScore).toBeGreaterThan(highScore);
    expect(lowScore).toBe(95);
    expect(highScore).toBe(20);
  });

  it("tokenEfficiency returns 50 for zero tokens", async () => {
    const run = { usage: { totalTokens: 0 }, cancel: vi.fn() };
    const score = await scorers.tokenEfficiency(run);
    expect(score).toBe(50);
  });

  it("tokenEfficiency clamps to 0-100 range", async () => {
    const hugeRun = { usage: { totalTokens: 50000 }, cancel: vi.fn() };
    const score = await scorers.tokenEfficiency(hugeRun);
    expect(score).toBe(0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
