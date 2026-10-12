/**
 * Pool run receipt — structured output from every pool run.
 * The receipt is the artifact that evals compare against baselines.
 */

import { writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface SeatResult {
  task: string;
  agentId: string;
  model: string;
  status: "completed" | "blocked" | "cancelled";
  pr: string | null;
  checks: Record<string, "success" | "failure" | "pending">;
  tokens: number;
  trippedLock: string | null;
  blockedReason: string | null;
}

export interface PoolReceipt {
  poolId: string;
  harness: string;
  started: string;
  finished: string;
  cap: number;
  seats: SeatResult[];
  summary: {
    completed: number;
    blocked: number;
    cancelled: number;
    totalTokens: number;
  };
}

/**
 * Compute summary counts from seat results.
 */
export function summarize(seats: SeatResult[]): PoolReceipt["summary"] {
  let completed = 0;
  let blocked = 0;
  let cancelled = 0;
  let totalTokens = 0;

  for (const s of seats) {
    if (s.status === "completed") completed++;
    else if (s.status === "blocked") blocked++;
    else if (s.status === "cancelled") cancelled++;
    totalTokens += s.tokens;
  }

  return { completed, blocked, cancelled, totalTokens };
}

/**
 * Write a receipt atomically: write to a .tmp file, then rename.
 */
export async function writeReceipt(
  receipt: PoolReceipt,
  path: string,
): Promise<void> {
  const tmpPath = join(dirname(path), `.${Date.now()}.receipt.tmp`);
  const json = JSON.stringify(receipt, null, 2) + "\n";
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}
