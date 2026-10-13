import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ScriptedBackend,
  type ScriptedRunConfig,
} from "../../harness/backends/scripted.js";
import type { VerifyResult, AllowlistResult } from "../../harness/gate.js";
import type { SpendConfig } from "../../harness/spend.js";
import {
  runPipeline,
  defaultStages,
  type PipelineConfig,
  type PipelineStage,
} from "./run.js";

/* ─── Mocks ─── */

vi.mock("../../harness/gate.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runVerify: vi.fn(),
    filesAllowlist: vi.fn(),
  };
});

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

import { runVerify, filesAllowlist } from "../../harness/gate.js";
import { writeFile, rename } from "node:fs/promises";

const mockRunVerify = vi.mocked(runVerify);
const mockFilesAllowlist = vi.mocked(filesAllowlist);
const mockWriteFile = vi.mocked(writeFile);
const mockRename = vi.mocked(rename);

/* ─── Helpers ─── */

function makeRunConfigs(count: number): ScriptedRunConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    agentId: `agent-stage-${i + 1}`,
    events: [{ type: "run_finished" as const, data: {} }],
    tokens: 500 * (i + 1),
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

function makeStages(count: number = 4): PipelineStage[] {
  const names = ["plan", "implement", "verify", "review"];
  return names.slice(0, count).map((name) => ({
    name,
    prompt: `${name} for: {task}`,
    verify: ["echo ok"],
  }));
}

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    pipelineId: "test-pipeline",
    task: "add user auth",
    stages: makeStages(),
    spend: makeSpend(),
    ...overrides,
  };
}

function verifyPass(): VerifyResult[] {
  return [{ command: "echo ok", exitCode: 0, output: "ok\n" }];
}

function verifyFail(cmd = "npm test", output = "error: tests failed"): VerifyResult[] {
  return [{ command: cmd, exitCode: 1, output }];
}

/* ─── Tests ─── */

beforeEach(() => {
  vi.clearAllMocks();
  mockFilesAllowlist.mockReturnValue({ violations: [] });
});

describe("runPipeline", () => {
  it("pipeline completes all 4 stages successfully", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(4));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPipeline(makeConfig(), backend);

    expect(receipt.finalStatus).toBe("success");
    expect(receipt.stages).toHaveLength(4);
    for (const stage of receipt.stages) {
      expect(stage.status).toBe("success");
    }
    expect(receipt.pipelineId).toBe("test-pipeline");
    expect(receipt.task).toBe("add user auth");
    expect(receipt.totalTokens).toBeGreaterThan(0);
    expect(receipt.totalDurationMs).toBeGreaterThanOrEqual(0);

    // Backend should have been called 4 times (one per stage)
    expect(backend.callLog.filter((c) => c.method === "create")).toHaveLength(4);
  });

  it("pipeline stops at failed stage, skips remaining", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(4));
    mockRunVerify
      .mockResolvedValueOnce(verifyPass())       // plan passes
      .mockResolvedValueOnce(verifyFail())        // implement fails
      .mockResolvedValue(verifyPass());           // should not be reached

    const receipt = await runPipeline(makeConfig(), backend);

    expect(receipt.finalStatus).toBe("failed");
    expect(receipt.stages[0].status).toBe("success");
    expect(receipt.stages[0].stage).toBe("plan");
    expect(receipt.stages[1].status).toBe("failed");
    expect(receipt.stages[1].stage).toBe("implement");
    expect(receipt.stages[1].error).toContain("Verify failed");
    expect(receipt.stages[2].status).toBe("skipped");
    expect(receipt.stages[2].stage).toBe("verify");
    expect(receipt.stages[3].status).toBe("skipped");
    expect(receipt.stages[3].stage).toBe("review");

    // Only 2 backend calls (plan + implement); skipped stages don't create agents
    expect(backend.callLog.filter((c) => c.method === "create")).toHaveLength(2);
  });

  it("pipeline records correct durations and tokens", async () => {
    const configs = makeRunConfigs(4); // tokens: 500, 1000, 1500, 2000
    const backend = new ScriptedBackend(configs);
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPipeline(makeConfig(), backend);

    expect(receipt.totalTokens).toBe(500 + 1000 + 1500 + 2000);
    expect(receipt.totalDurationMs).toBeGreaterThanOrEqual(0);

    for (const stage of receipt.stages) {
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
    }

    // Skipped stages have 0 duration
    // (no skips in this test, but verify all are ≥ 0)
    expect(receipt.stages.every((s) => s.durationMs >= 0)).toBe(true);
  });

  it("pipeline replaces {task} in stage prompts", async () => {
    const stages: PipelineStage[] = [
      { name: "plan", prompt: "Plan the {task} feature", verify: ["echo ok"] },
      { name: "build", prompt: "Build {task} now", verify: ["echo ok"] },
    ];
    const backend = new ScriptedBackend(makeRunConfigs(2));
    mockRunVerify.mockResolvedValue(verifyPass());

    await runPipeline(makeConfig({ stages, task: "search API" }), backend);

    const createCalls = backend.callLog.filter((c) => c.method === "create");
    expect(createCalls).toHaveLength(2);

    const prompt0 = (createCalls[0].args[0] as Record<string, unknown>).prompt;
    const prompt1 = (createCalls[1].args[0] as Record<string, unknown>).prompt;
    expect(prompt0).toBe("Plan the search API feature");
    expect(prompt1).toBe("Build search API now");
  });

  it("pipeline uses stage-specific model override", async () => {
    const stages: PipelineStage[] = [
      { name: "plan", prompt: "Plan {task}", verify: ["echo ok"] },
      { name: "implement", prompt: "Implement {task}", verify: ["echo ok"], model: "claude-4-opus" },
      { name: "review", prompt: "Review {task}", verify: ["echo ok"] },
    ];
    const backend = new ScriptedBackend(makeRunConfigs(3));
    mockRunVerify.mockResolvedValue(verifyPass());

    await runPipeline(makeConfig({ stages }), backend);

    const createCalls = backend.callLog.filter((c) => c.method === "create");
    const models = createCalls.map(
      (c) => (c.args[0] as Record<string, unknown>).model,
    );

    expect(models[0]).toBe("test-model");       // default from spend
    expect(models[1]).toBe("claude-4-opus");     // stage override
    expect(models[2]).toBe("test-model");       // default from spend
  });

  it("pipeline writes receipt when path provided", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(4));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPipeline(
      makeConfig({ receiptPath: "/tmp/h3-receipt.json" }),
      backend,
    );

    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockRename).toHaveBeenCalledOnce();

    // Verify the written content is valid JSON matching the receipt
    const writtenJson = mockWriteFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenJson);
    expect(parsed.pipelineId).toBe(receipt.pipelineId);
    expect(parsed.finalStatus).toBe(receipt.finalStatus);
    expect(parsed.stages).toHaveLength(receipt.stages.length);

    // Rename target should be the receipt path
    expect(mockRename.mock.calls[0][1]).toBe("/tmp/h3-receipt.json");
  });

  it("pipeline does not write receipt when path omitted", async () => {
    const backend = new ScriptedBackend(makeRunConfigs(4));
    mockRunVerify.mockResolvedValue(verifyPass());

    await runPipeline(makeConfig({ receiptPath: undefined }), backend);

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it("pipeline works with single stage", async () => {
    const stages: PipelineStage[] = [
      { name: "all-in-one", prompt: "Do everything for {task}", verify: ["echo ok"] },
    ];
    const backend = new ScriptedBackend(makeRunConfigs(1));
    mockRunVerify.mockResolvedValue(verifyPass());

    const receipt = await runPipeline(makeConfig({ stages }), backend);

    expect(receipt.finalStatus).toBe("success");
    expect(receipt.stages).toHaveLength(1);
    expect(receipt.stages[0].stage).toBe("all-in-one");
    expect(receipt.stages[0].status).toBe("success");
    expect(receipt.totalTokens).toBe(500);

    expect(backend.callLog.filter((c) => c.method === "create")).toHaveLength(1);
  });

  it("pipeline fails on filesAllowlist violation", async () => {
    const stages: PipelineStage[] = [
      { name: "plan", prompt: "Plan {task}", verify: ["echo ok"] },
      {
        name: "implement",
        prompt: "Implement {task}",
        verify: ["echo ok"],
        filesAllowlist: ["src/auth.ts", "src/auth.test.ts"],
      },
      { name: "review", prompt: "Review {task}", verify: ["echo ok"] },
    ];

    // Create a ScriptedRun that exposes diffPaths
    const configs: ScriptedRunConfig[] = [
      { agentId: "agent-1", events: [], tokens: 500 },
      { agentId: "agent-2", events: [], tokens: 1000 },
      { agentId: "agent-3", events: [], tokens: 1500 },
    ];
    const backend = new ScriptedBackend(configs);

    mockRunVerify.mockResolvedValue(verifyPass());

    // The filesAllowlist function is mocked — simulate a violation.
    // Plan stage has no allowlist so filesAllowlist won't be called for it;
    // the first real call is for implement.
    mockFilesAllowlist
      .mockReturnValueOnce({ violations: ["src/secret.ts"] });

    // Patch the ScriptedRun to have diffPaths
    const origCreate = backend.create.bind(backend);
    let callCount = 0;
    backend.create = async (opts) => {
      const run = await origCreate(opts);
      callCount++;
      if (callCount === 2) {
        (run as Record<string, unknown>).diffPaths = ["src/auth.ts", "src/secret.ts"];
      }
      return run;
    };

    const receipt = await runPipeline(makeConfig({ stages }), backend);

    expect(receipt.finalStatus).toBe("failed");
    expect(receipt.stages[0].status).toBe("success");
    expect(receipt.stages[1].status).toBe("failed");
    expect(receipt.stages[1].error).toContain("Files allowlist violation");
    expect(receipt.stages[1].error).toContain("src/secret.ts");
    expect(receipt.stages[2].status).toBe("skipped");
  });
});

describe("defaultStages", () => {
  it("returns 4 stages with default prompts", () => {
    const stages = defaultStages();

    expect(stages).toHaveLength(4);
    expect(stages.map((s) => s.name)).toEqual(["plan", "implement", "verify", "review"]);
    expect(stages[0].prompt).toContain("{task}");
    expect(stages[1].verify).toEqual(["npm test"]);
    expect(stages[2].verify).toEqual(["npm test", "npm run lint"]);
  });

  it("applies overrides to specific stages", () => {
    const stages = defaultStages({
      plan: { verify: ["echo plan-ok"] },
      review: { model: "claude-4-opus", prompt: "Custom review: {task}" },
    });

    expect(stages[0].verify).toEqual(["echo plan-ok"]);
    expect(stages[0].prompt).toContain("{task}"); // default prompt preserved
    expect(stages[3].model).toBe("claude-4-opus");
    expect(stages[3].prompt).toBe("Custom review: {task}");
  });

  it("does not mutate when no overrides given", () => {
    const a = defaultStages();
    const b = defaultStages();
    expect(a).toEqual(b);
    a[0].name = "mutated";
    expect(b[0].name).toBe("plan");
  });
});
