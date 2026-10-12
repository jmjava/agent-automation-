import { describe, it, expect, vi } from "vitest";
import { guard, type AgentRun, type SpendConfig } from "./spend.js";

function makeConfig(overrides: Partial<SpendConfig> = {}): SpendConfig {
  return {
    model: "test-model",
    maxSends: 10,
    runTimeoutMs: 60_000,
    maxTotalTokens: 100_000,
    wallMs: 120_000,
    ...overrides,
  };
}

function makeRun(tokens: number): AgentRun & { cancel: ReturnType<typeof vi.fn> } {
  return {
    usage: { totalTokens: tokens },
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

describe("spend guard", () => {
  it("returns not tripped when under all caps", async () => {
    const run = makeRun(500);
    const config = makeConfig();
    const result = await guard(run, config, Date.now(), 1);

    expect(result.tripped).toBe(false);
    expect(result.lockName).toBeNull();
    expect(run.cancel).not.toHaveBeenCalled();
  });

  it("trips maxTotalTokens and cancels", async () => {
    const run = makeRun(200_000);
    const config = makeConfig({ maxTotalTokens: 100_000 });
    const result = await guard(run, config, Date.now(), 1);

    expect(result.tripped).toBe(true);
    expect(result.lockName).toBe("maxTotalTokens");
    expect(run.cancel).toHaveBeenCalledOnce();
  });

  it("trips runTimeout and cancels", async () => {
    const run = makeRun(100);
    const config = makeConfig({ runTimeoutMs: 1000 });
    const startTime = Date.now() - 2000;
    const result = await guard(run, config, startTime, 1);

    expect(result.tripped).toBe(true);
    expect(result.lockName).toBe("runTimeout");
    expect(run.cancel).toHaveBeenCalledOnce();
  });

  it("trips maxSends and cancels", async () => {
    const run = makeRun(100);
    const config = makeConfig({ maxSends: 5 });
    const result = await guard(run, config, Date.now(), 6);

    expect(result.tripped).toBe(true);
    expect(result.lockName).toBe("maxSends");
    expect(run.cancel).toHaveBeenCalledOnce();
  });

  it("trips wallBudget and cancels", async () => {
    const run = makeRun(100);
    const config = makeConfig({ wallMs: 500 });
    const startTime = Date.now() - 1000;
    const result = await guard(run, config, startTime, 1);

    expect(result.tripped).toBe(true);
    expect(result.lockName).toBe("wallBudget");
    expect(run.cancel).toHaveBeenCalledOnce();
  });

  it("maxTotalTokens takes priority over runTimeout", async () => {
    const run = makeRun(200_000);
    const config = makeConfig({ maxTotalTokens: 100_000, runTimeoutMs: 1 });
    const startTime = Date.now() - 5000;
    const result = await guard(run, config, startTime, 1);

    expect(result.tripped).toBe(true);
    expect(result.lockName).toBe("maxTotalTokens");
  });

  it("reports usage correctly", async () => {
    const run = makeRun(42_000);
    const config = makeConfig();
    const startTime = Date.now() - 3000;
    const result = await guard(run, config, startTime, 7);

    expect(result.usage.tokens).toBe(42_000);
    expect(result.usage.sends).toBe(7);
    expect(result.usage.elapsedMs).toBeGreaterThanOrEqual(2900);
  });
});
