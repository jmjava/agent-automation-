import { describe, it, expect } from "vitest";
import { ScriptedBackend, type ScriptedRunConfig, ScriptedRun } from "./scripted.js";

function makeRunConfig(overrides: Partial<ScriptedRunConfig> = {}): ScriptedRunConfig {
  return {
    agentId: "agent-001",
    events: [
      { type: "pr_created", data: { url: "https://github.com/org/repo/pull/1" } },
      { type: "checks_complete", data: { build: "success" } },
      { type: "run_finished", data: {} },
    ],
    tokens: 5000,
    ...overrides,
  };
}

describe("ScriptedBackend", () => {
  it("replays events in order", async () => {
    const config = makeRunConfig();
    const backend = new ScriptedBackend([config]);

    const run = await backend.create({
      repo: "org/repo",
      ref: "main",
      prompt: "Fix the bug",
      model: "test-model",
      metadata: { pool: "test" },
    });

    expect(run).toBeInstanceOf(ScriptedRun);
    expect(run.agentId).toBe("agent-001");
    expect(run.events).toHaveLength(3);
    expect(run.events[0].type).toBe("pr_created");
    expect(run.events[1].type).toBe("checks_complete");
    expect(run.events[2].type).toBe("run_finished");
  });

  it("records every call in the call log", async () => {
    const backend = new ScriptedBackend([makeRunConfig()]);

    const opts = {
      repo: "org/repo",
      ref: "main",
      prompt: "Fix",
      model: "model",
      metadata: {},
    };
    await backend.create(opts);

    expect(backend.callLog).toHaveLength(1);
    expect(backend.callLog[0].method).toBe("create");
    expect(backend.callLog[0].args[0]).toEqual(opts);
  });

  it("reports token usage from config", async () => {
    const backend = new ScriptedBackend([makeRunConfig({ tokens: 42_000 })]);
    const run = await backend.create({
      repo: "r", ref: "m", prompt: "p", model: "m", metadata: {},
    });
    expect(run.usage.totalTokens).toBe(42_000);
  });

  it("cancel marks the run as cancelled", async () => {
    const backend = new ScriptedBackend([makeRunConfig()]);
    const run = await backend.create({
      repo: "r", ref: "m", prompt: "p", model: "m", metadata: {},
    });
    expect(run.cancelled).toBe(false);
    await run.cancel();
    expect(run.cancelled).toBe(true);
  });

  it("throws when no more run configs are available", async () => {
    const backend = new ScriptedBackend([]);
    await expect(
      backend.create({ repo: "r", ref: "m", prompt: "p", model: "m", metadata: {} }),
    ).rejects.toThrow(/no more run configs/);
  });

  it("resume finds the right agent by id", async () => {
    const configs = [
      makeRunConfig({ agentId: "agent-A", tokens: 100 }),
      makeRunConfig({ agentId: "agent-B", tokens: 200 }),
    ];
    const backend = new ScriptedBackend(configs);

    const run = await backend.resume("agent-B");
    expect(run.agentId).toBe("agent-B");
    expect(run.usage.totalTokens).toBe(200);
    expect(backend.callLog[0].method).toBe("resume");
  });

  it("resume throws for unknown agent", async () => {
    const backend = new ScriptedBackend([makeRunConfig()]);
    await expect(backend.resume("unknown")).rejects.toThrow(/no run config/);
  });

  it("cancel records in call log", async () => {
    const backend = new ScriptedBackend([]);
    await backend.cancel("run-xyz");
    expect(backend.callLog[0]).toEqual({ method: "cancel", args: ["run-xyz"] });
  });

  it("serves multiple creates in order", async () => {
    const backend = new ScriptedBackend([
      makeRunConfig({ agentId: "first", tokens: 100 }),
      makeRunConfig({ agentId: "second", tokens: 200 }),
    ]);

    const r1 = await backend.create({ repo: "r", ref: "m", prompt: "p", model: "m", metadata: {} });
    const r2 = await backend.create({ repo: "r", ref: "m", prompt: "p", model: "m", metadata: {} });

    expect(r1.agentId).toBe("first");
    expect(r2.agentId).toBe("second");
  });
});
