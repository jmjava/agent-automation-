import { describe, it, expect } from "vitest";
import { readFile, stat, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeReceipt, summarize, type PoolReceipt, type SeatResult } from "./receipt.js";
import schema from "./receipt.schema.json" with { type: "json" };

function makeSeat(overrides: Partial<SeatResult> = {}): SeatResult {
  return {
    task: "FEAT-001",
    agentId: "agent-abc",
    model: "test-model",
    status: "completed",
    pr: "https://github.com/org/repo/pull/1",
    checks: { build: "success", lint: "success" },
    tokens: 5000,
    trippedLock: null,
    blockedReason: null,
    ...overrides,
  };
}

function makeReceipt(seats: SeatResult[] = [makeSeat()]): PoolReceipt {
  return {
    poolId: "pool-001",
    harness: "h1-queue-pool",
    started: "2026-10-12T19:00:00.000Z",
    finished: "2026-10-12T19:30:00.000Z",
    cap: 7,
    seats,
    summary: summarize(seats),
  };
}

describe("summarize", () => {
  it("counts completed, blocked, cancelled, and total tokens", () => {
    const seats = [
      makeSeat({ status: "completed", tokens: 1000 }),
      makeSeat({ status: "blocked", tokens: 2000 }),
      makeSeat({ status: "cancelled", tokens: 3000 }),
      makeSeat({ status: "completed", tokens: 500 }),
    ];
    const summary = summarize(seats);
    expect(summary).toEqual({
      completed: 2,
      blocked: 1,
      cancelled: 1,
      totalTokens: 6500,
    });
  });

  it("handles empty seats", () => {
    expect(summarize([])).toEqual({
      completed: 0, blocked: 0, cancelled: 0, totalTokens: 0,
    });
  });
});

describe("writeReceipt", () => {
  it("writes valid JSON atomically", async () => {
    const dir = join(tmpdir(), `receipt-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "receipt.json");

    const receipt = makeReceipt();
    await writeReceipt(receipt, outPath);

    const content = await readFile(outPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.poolId).toBe("pool-001");
    expect(parsed.seats).toHaveLength(1);

    // No .tmp file should remain
    const tmpFiles = await stat(join(dir, ".tmp")).catch(() => null);
    expect(tmpFiles).toBeNull();

    await rm(dir, { recursive: true });
  });

  it("round-trips all fields", async () => {
    const dir = join(tmpdir(), `receipt-rt-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "receipt.json");

    const receipt = makeReceipt([
      makeSeat({ status: "blocked", blockedReason: "CI failure" }),
    ]);
    await writeReceipt(receipt, outPath);

    const content = await readFile(outPath, "utf-8");
    const parsed = JSON.parse(content) as PoolReceipt;
    expect(parsed.seats[0].blockedReason).toBe("CI failure");

    await rm(dir, { recursive: true });
  });
});

describe("receipt schema", () => {
  it("schema has the required top-level fields", () => {
    expect(schema.required).toContain("poolId");
    expect(schema.required).toContain("seats");
    expect(schema.required).toContain("summary");
    expect(schema.required).toContain("started");
    expect(schema.required).toContain("finished");
    expect(schema.required).toContain("cap");
    expect(schema.required).toContain("harness");
  });

  it("seat schema has all required fields", () => {
    const seatSchema = schema.properties.seats.items;
    expect(seatSchema.required).toContain("task");
    expect(seatSchema.required).toContain("agentId");
    expect(seatSchema.required).toContain("status");
    expect(seatSchema.required).toContain("tokens");
    expect(seatSchema.required).toContain("trippedLock");
    expect(seatSchema.required).toContain("blockedReason");
  });
});
