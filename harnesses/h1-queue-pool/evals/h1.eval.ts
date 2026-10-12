/**
 * H1 queue-pool eval — exercises the coordinator with the ScriptedBackend.
 */

import { describe, it, expect } from "vitest";
import { runPool, type PoolConfig, type TaskEntry } from "../run.js";
import { ScriptedBackend, type ScriptedRunConfig } from "../../../harness/backends/scripted.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, rm, mkdir } from "node:fs/promises";

function makeTasks(count: number): TaskEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `FEAT-${String(i + 1).padStart(3, "0")}`,
    title: `Task ${i + 1}`,
    repo: "jmjava/pool-fixture",
    ref: "main",
    model: "test-model",
    prompt: `Do task ${i + 1}`,
    files: [`src/file${i + 1}.ts`],
    testGlobs: ["**/*.test.ts"],
    verifyCommands: ["npm test"],
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

async function makeConfig(
  backend: ScriptedBackend,
  dir: string,
  cap = 7,
): Promise<PoolConfig> {
  await mkdir(dir, { recursive: true });
  return {
    cap,
    spend: {
      model: "test-model",
      maxSends: 50,
      runTimeoutMs: 600_000,
      maxTotalTokens: 500_000,
      wallMs: 1_200_000,
    },
    backend,
    receiptPath: join(dir, "receipt.json"),
  };
}

describe("H1 queue-pool coordinator", () => {
  it("enforces the Rule of 3: fewer than 3 tasks are blocked", async () => {
    const dir = join(tmpdir(), `h1-rule3-${Date.now()}`);
    const backend = new ScriptedBackend([]);
    const config = await makeConfig(backend, dir, 7);

    const receipt = await runPool(makeTasks(2), config);

    expect(receipt.seats).toHaveLength(2);
    expect(receipt.seats.every((s) => s.status === "blocked")).toBe(true);
    expect(receipt.seats[0].blockedReason).toMatch(/Rule of 3/);
    expect(receipt.summary.blocked).toBe(2);

    await rm(dir, { recursive: true });
  });

  it("processes tasks up to the cap", async () => {
    const dir = join(tmpdir(), `h1-cap-${Date.now()}`);
    const tasks = makeTasks(5);
    const backend = new ScriptedBackend(makeRunConfigs(5));
    const config = await makeConfig(backend, dir, 3);

    await runPool(tasks, config);

    // Should have created 3 agents (cap) from the 5 tasks
    const creates = backend.callLog.filter((c) => c.method === "create");
    expect(creates.length).toBeLessThanOrEqual(3);

    await rm(dir, { recursive: true });
  });

  it("writes a valid receipt file", async () => {
    const dir = join(tmpdir(), `h1-receipt-${Date.now()}`);
    const tasks = makeTasks(4);
    const backend = new ScriptedBackend(makeRunConfigs(4));
    const config = await makeConfig(backend, dir, 7);

    await runPool(tasks, config);

    const content = await readFile(config.receiptPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.harness).toBe("h1-queue-pool");
    expect(parsed.poolId).toMatch(/^pool-/);
    expect(parsed.summary).toBeDefined();

    await rm(dir, { recursive: true });
  });

  it("cancels runs that exceed spend caps", async () => {
    const dir = join(tmpdir(), `h1-spend-${Date.now()}`);
    const tasks = makeTasks(3);
    const backend = new ScriptedBackend(
      makeRunConfigs(3).map((c) => ({ ...c, tokens: 999_999 })),
    );
    const config = await makeConfig(backend, dir, 7);
    config.spend.maxTotalTokens = 100_000;

    const receipt = await runPool(tasks, config);

    const cancelled = receipt.seats.filter((s) => s.status === "cancelled");
    expect(cancelled.length).toBeGreaterThan(0);
    expect(cancelled[0].trippedLock).toBe("maxTotalTokens");

    await rm(dir, { recursive: true });
  });
});
