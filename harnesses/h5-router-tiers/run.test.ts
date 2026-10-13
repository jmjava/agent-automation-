import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ScriptedBackend,
  type ScriptedRunConfig,
} from "../../harness/backends/scripted.js";
import type { VerifyResult } from "../../harness/gate.js";
import type { SpendConfig } from "../../harness/spend.js";
import {
  runRouter,
  classifiers,
  type RouterConfig,
  type TierConfig,
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
    agentId: `agent-${i}`,
    events: [{ type: "run_finished" as const, data: {} }],
    tokens: tokensFn ? tokensFn(i) : 1000,
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

const defaultTiers: TierConfig[] = [
  { name: "fast", model: "gpt-fast" },
  { name: "standard", model: "gpt-standard" },
  { name: "premium", model: "gpt-premium" },
];

function makeConfig(overrides?: Partial<RouterConfig>): RouterConfig {
  return {
    routerId: "test-router",
    tiers: defaultTiers,
    classifier: classifiers.alwaysCheap,
    spend: makeSpend(),
    verify: ["npm test"],
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

describe("runRouter", () => {
  it("router sends tasks to classified tiers", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const tierClassifier = async (task: string) => {
      if (task.includes("easy")) return "fast";
      if (task.includes("medium")) return "standard";
      return "premium";
    };

    const receipt = await runRouter(
      makeConfig({ classifier: tierClassifier }),
      ["easy task", "medium task", "hard task"],
      backend,
    );

    expect(receipt.results).toHaveLength(3);
    expect(receipt.results[0].tier).toBe("fast");
    expect(receipt.results[1].tier).toBe("standard");
    expect(receipt.results[2].tier).toBe("premium");

    const calls = backend.callLog.filter((c) => c.method === "create");
    expect(calls).toHaveLength(3);
    expect((calls[0].args[0] as Record<string, unknown>).model).toBe("gpt-fast");
    expect((calls[1].args[0] as Record<string, unknown>).model).toBe("gpt-standard");
    expect((calls[2].args[0] as Record<string, unknown>).model).toBe("gpt-premium");
  });

  it("router escalates on verify failure", async () => {
    // 2 runs needed: first (fast) fails, second (standard) passes
    const backend = new ScriptedBackend(makeRunConfigs(2));
    mockRunVerify
      .mockResolvedValueOnce(verifyFail())
      .mockResolvedValueOnce(verifyPass());

    const receipt = await runRouter(
      makeConfig({ classifier: classifiers.alwaysCheap }),
      ["fix the bug"],
      backend,
    );

    expect(receipt.results).toHaveLength(1);
    expect(receipt.results[0].status).toBe("escalated");
    expect(receipt.results[0].tier).toBe("fast");
    expect(receipt.results[0].finalTier).toBe("standard");
    expect(receipt.escalations).toBe(1);

    const calls = backend.callLog.filter((c) => c.method === "create");
    expect(calls).toHaveLength(2);
    expect((calls[0].args[0] as Record<string, unknown>).model).toBe("gpt-fast");
    expect((calls[1].args[0] as Record<string, unknown>).model).toBe("gpt-standard");
  });

  it("router stops at most expensive tier on failure", async () => {
    // 3 runs: all fail (fast → standard → premium, all fail)
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyFail());

    const receipt = await runRouter(
      makeConfig({ classifier: classifiers.alwaysCheap }),
      ["impossible task"],
      backend,
    );

    expect(receipt.results).toHaveLength(1);
    expect(receipt.results[0].status).toBe("failed");
    expect(receipt.results[0].tier).toBe("fast");
    expect(receipt.results[0].finalTier).toBe("premium");

    const calls = backend.callLog.filter((c) => c.method === "create");
    expect(calls).toHaveLength(3);
  });

  it("router records tier breakdown correctly", async () => {
    // 3 tasks: first goes to fast (pass), second to standard (pass), third to fast (fail→standard pass)
    const backend = new ScriptedBackend(makeRunConfigs(4, () => 500));
    mockRunVerify
      .mockResolvedValueOnce(verifyPass())   // task 1: fast pass
      .mockResolvedValueOnce(verifyPass())   // task 2: standard pass
      .mockResolvedValueOnce(verifyFail())   // task 3: fast fail
      .mockResolvedValueOnce(verifyPass());  // task 3: standard pass (escalated)

    let callCount = 0;
    const classifier = async (_task: string) => {
      const tiers = ["fast", "standard", "fast"];
      return tiers[callCount++];
    };

    const receipt = await runRouter(
      makeConfig({ classifier }),
      ["task-a", "task-b", "task-c"],
      backend,
    );

    expect(receipt.tierBreakdown.fast.count).toBe(2);
    expect(receipt.tierBreakdown.fast.successes).toBe(1);
    expect(receipt.tierBreakdown.standard.count).toBe(2);
    expect(receipt.tierBreakdown.standard.successes).toBe(2);
    expect(receipt.totalTokens).toBe(2000);
  });

  it("router handles all tasks in same tier", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runRouter(
      makeConfig({ classifier: classifiers.alwaysCheap }),
      ["task-1", "task-2", "task-3"],
      backend,
    );

    expect(receipt.results).toHaveLength(3);
    expect(receipt.results.every((r) => r.tier === "fast")).toBe(true);
    expect(receipt.results.every((r) => r.status === "success")).toBe(true);
    expect(receipt.tierBreakdown.fast.count).toBe(3);
    expect(receipt.tierBreakdown.fast.successes).toBe(3);
    expect(receipt.tierBreakdown.standard.count).toBe(0);
    expect(receipt.tierBreakdown.premium.count).toBe(0);
  });

  it("router writes receipt with escalation count", async () => {
    // 1 task: fast fails, standard passes → 1 escalation
    const backend = new ScriptedBackend(makeRunConfigs(2));
    mockRunVerify
      .mockResolvedValueOnce(verifyFail())
      .mockResolvedValueOnce(verifyPass());

    const receipt = await runRouter(
      makeConfig({
        classifier: classifiers.alwaysCheap,
        receiptPath: "/tmp/h5-receipt.json",
      }),
      ["escalation task"],
      backend,
    );

    expect(receipt.escalations).toBe(1);
    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockRename).toHaveBeenCalledOnce();

    const writtenJson = mockWriteFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenJson);
    expect(parsed.routerId).toBe("test-router");
    expect(parsed.escalations).toBe(1);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].status).toBe("escalated");

    expect(mockRename.mock.calls[0][1]).toBe("/tmp/h5-receipt.json");
  });

  it("router handles single tier (no escalation possible)", async () => {
    const singleTier: TierConfig[] = [{ name: "only", model: "gpt-only" }];
    const backend = new ScriptedBackend(makeRunConfigs(1));
    mockRunVerify.mockResolvedValue(verifyFail());

    const receipt = await runRouter(
      makeConfig({
        tiers: singleTier,
        classifier: async () => "only",
      }),
      ["doomed task"],
      backend,
    );

    expect(receipt.results).toHaveLength(1);
    expect(receipt.results[0].status).toBe("failed");
    expect(receipt.escalations).toBe(0);

    const calls = backend.callLog.filter((c) => c.method === "create");
    expect(calls).toHaveLength(1);
  });
});

describe("classifiers", () => {
  it("byLength classifier routes by thresholds", async () => {
    const classify = classifiers.byLength({ short: 20, medium: 50 });

    expect(await classify("short")).toBe("fast");
    expect(await classify("a medium-length task description")).toBe("standard");
    expect(await classify("a very long and detailed task description that exceeds the medium threshold by quite a lot")).toBe("premium");
  });

  it("byKeyword classifier matches keywords", async () => {
    const classify = classifiers.byKeyword({
      fast: ["typo", "rename"],
      standard: ["refactor", "test"],
      premium: ["architecture", "migration"],
    });

    expect(await classify("fix a typo in README")).toBe("fast");
    expect(await classify("refactor the auth module")).toBe("standard");
    expect(await classify("plan architecture for new service")).toBe("premium");
    expect(await classify("something unrelated")).toBe("fast"); // defaults to first
  });

  it("alwaysCheap sends everything to first tier", async () => {
    expect(await classifiers.alwaysCheap("any task")).toBe("fast");
    expect(await classifiers.alwaysCheap("complex migration")).toBe("fast");
    expect(await classifiers.alwaysCheap("")).toBe("fast");
  });
});
