import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Patrol,
  type PatrolConfig,
  type StallAction,
  type StallHandler,
} from "./run.js";

/* ─── Helpers ─── */

function makeConfig(overrides?: Partial<PatrolConfig>): PatrolConfig {
  return {
    patrolId: "test-patrol",
    pollIntervalMs: 30_000,
    stallThresholdMs: 300_000,
    maxNudges: 2,
    onStall: vi.fn().mockResolvedValue("nudge" as StallAction),
    ...overrides,
  };
}

/* ─── Tests ─── */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Patrol", () => {
  it("detects stalled agent after threshold", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol(makeConfig({ stallThresholdMs: 5000, onStall }));

    patrol.watch("agent-1");

    vi.advanceTimersByTime(6000);

    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(1);
    expect(stalled[0].agentId).toBe("agent-1");
    expect(onStall).toHaveBeenCalledWith("agent-1", expect.any(Number), 0);
    expect(onStall.mock.calls[0][1]).toBeGreaterThanOrEqual(5000);
  });

  it("ignores active agents", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol(makeConfig({ stallThresholdMs: 5000, onStall }));

    patrol.watch("agent-1");

    vi.advanceTimersByTime(2000);

    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(0);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("nudges up to maxNudges then cancels", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol(
      makeConfig({ stallThresholdMs: 1000, maxNudges: 2, onStall }),
    );

    patrol.watch("agent-1");

    // First stall → nudge 1
    vi.advanceTimersByTime(2000);
    await patrol.tick();
    expect(onStall).toHaveBeenCalledTimes(1);

    // Second stall → nudge 2
    vi.advanceTimersByTime(2000);
    await patrol.tick();
    expect(onStall).toHaveBeenCalledTimes(2);

    // Third check → maxNudges reached, auto-cancel without calling handler
    vi.advanceTimersByTime(2000);
    const stalled = await patrol.tick();
    expect(onStall).toHaveBeenCalledTimes(2);
    expect(stalled).toHaveLength(1);
    expect(stalled[0].status).toBe("cancelled");
  });

  it("heartbeat resets stall timer", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol(makeConfig({ stallThresholdMs: 5000, onStall }));

    patrol.watch("agent-1");

    vi.advanceTimersByTime(4000);
    patrol.heartbeat("agent-1");

    vi.advanceTimersByTime(4000);

    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(0);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("complete stops watching agent", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol(makeConfig({ stallThresholdMs: 1000, onStall }));

    patrol.watch("agent-1");
    patrol.complete("agent-1");

    vi.advanceTimersByTime(5000);

    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(0);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("tick checks all agents once", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol(makeConfig({ stallThresholdMs: 1000, onStall }));

    patrol.watch("agent-1");
    patrol.watch("agent-2");
    patrol.watch("agent-3");

    vi.advanceTimersByTime(2000);

    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(3);
    expect(onStall).toHaveBeenCalledTimes(3);
    expect(stalled.map((a) => a.agentId).sort()).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
    ]);
  });

  it("report has correct counts", async () => {
    const onStall = vi.fn().mockResolvedValue("cancel" as StallAction);
    const patrol = new Patrol(makeConfig({ stallThresholdMs: 1000, onStall }));

    await patrol.start();

    patrol.watch("agent-1");
    patrol.watch("agent-2");
    patrol.complete("agent-2");

    vi.advanceTimersByTime(2000);
    await patrol.tick();

    const report = patrol.stop();

    expect(report.patrolId).toBe("test-patrol");
    expect(report.agents).toHaveLength(2);
    expect(report.totalCancelled).toBe(1);
    expect(report.totalNudges).toBe(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles empty agent list", async () => {
    const onStall = vi.fn().mockResolvedValue("nudge" as StallAction);
    const patrol = new Patrol(makeConfig({ onStall }));

    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(0);
    expect(onStall).not.toHaveBeenCalled();

    const report = patrol.stop();
    expect(report.agents).toHaveLength(0);
    expect(report.totalNudges).toBe(0);
    expect(report.totalCancelled).toBe(0);
  });

  it("respects ignore action from handler", async () => {
    const onStall = vi.fn().mockResolvedValue("ignore" as StallAction);
    const patrol = new Patrol(makeConfig({ stallThresholdMs: 1000, onStall }));

    patrol.watch("agent-1");

    vi.advanceTimersByTime(2000);
    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(1);
    expect(stalled[0].status).toBe("active");
    expect(stalled[0].nudgeCount).toBe(0);

    // Stays active on subsequent ticks — handler keeps returning ignore
    vi.advanceTimersByTime(2000);
    const stalled2 = await patrol.tick();
    expect(stalled2).toHaveLength(1);
    expect(stalled2[0].status).toBe("active");
  });

  it("handles concurrent stalls", async () => {
    const actions: Record<string, StallAction> = {
      "agent-1": "nudge",
      "agent-2": "cancel",
      "agent-3": "ignore",
    };

    const onStall: StallHandler = vi.fn(
      async (agentId: string) => actions[agentId],
    );

    const patrol = new Patrol(makeConfig({ stallThresholdMs: 1000, onStall }));

    patrol.watch("agent-1");
    patrol.watch("agent-2");
    patrol.watch("agent-3");

    vi.advanceTimersByTime(2000);

    const stalled = await patrol.tick();

    expect(stalled).toHaveLength(3);
    expect(onStall).toHaveBeenCalledTimes(3);

    const byId = Object.fromEntries(stalled.map((a) => [a.agentId, a]));

    expect(byId["agent-1"].status).toBe("stalled");
    expect(byId["agent-1"].nudgeCount).toBe(1);

    expect(byId["agent-2"].status).toBe("cancelled");

    expect(byId["agent-3"].status).toBe("active");
    expect(byId["agent-3"].nudgeCount).toBe(0);
  });
});
