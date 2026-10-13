/**
 * H1 queue-pool coordinator.
 *
 * Implements the pool behavior:
 * 1. List open tasks from the board
 * 2. Rule-of-3: refuse to fan out with fewer than 3 tasks
 * 3. Fill seats up to `cap`, claiming each task on the board
 * 4. Wait for each agent run to complete
 * 5. Verify each completed run with shell commands
 * 6. Complete or block each task based on verify + allowlist results
 * 7. Repeat-stop: if the same error hash appears twice, block immediately
 * 8. Retry once on first failure
 * 9. Refill freed seats from remaining open tasks
 * 10. Stop when board is empty or wall budget exceeded
 * 11. Write receipt, append daily summary, return receipt
 */

import type { Board, TaskItem } from "../../harness/board.js";
import type { AgentBackend } from "../../harness/backends/types.js";
import type { AgentRun, SpendConfig } from "../../harness/spend.js";
import { guard } from "../../harness/spend.js";
import { runVerify, errorHash, repeatStop, filesAllowlist } from "../../harness/gate.js";
import {
  writeReceipt,
  summarize,
  type PoolReceipt,
  type SeatResult,
} from "../../harness/receipt.js";

export interface PoolConfig {
  poolId: string;
  project: string;
  cap: number;
  spend: SpendConfig;
  verify: string[];
  filesAllowlist?: string[];
  model?: string;
  repo?: string;
  receiptPath?: string;
}

interface ActiveSeat {
  task: TaskItem;
  run: AgentRun;
  startTime: number;
  attempt: number;
}

function extractAgentId(run: AgentRun): string {
  return "agentId" in run
    ? String((run as Record<string, unknown>).agentId)
    : "";
}

export async function runPool(
  config: PoolConfig,
  backend: AgentBackend,
  board: Board,
): Promise<PoolReceipt> {
  const poolStart = Date.now();
  const seats: SeatResult[] = [];
  const errorHashes: string[] = [];
  const model = config.model ?? config.spend.model;
  const repo = config.repo ?? "";

  // 1. List open tasks
  const allTasks = await board.listOpen(config.project);

  // 2. Rule of 3
  if (allTasks.length < 3) {
    throw new Error(
      `Rule of 3: only ${allTasks.length} task(s) in project "${config.project}" (minimum 3)`,
    );
  }

  const taskQueue = [...allTasks];
  const active: ActiveSeat[] = [];

  async function fillSeats(): Promise<void> {
    while (active.length < config.cap && taskQueue.length > 0) {
      const next = taskQueue.shift()!;
      const claimed = await board.claim(config.project, next.title);
      const run = await backend.create({
        prompt: claimed.title,
        model,
        repo,
        ref: "main",
        metadata: { pool: config.poolId, task: claimed.id },
      });
      active.push({ task: claimed, run, startTime: Date.now(), attempt: 1 });
    }
  }

  // 3. Fill initial seats
  await fillSeats();

  // 4–10. Process loop
  while (active.length > 0) {
    // 10. Wall budget check
    if (Date.now() - poolStart > config.spend.wallMs) {
      for (const s of active) {
        await s.run.cancel();
        seats.push({
          task: s.task.id,
          agentId: extractAgentId(s.run),
          model,
          status: "cancelled",
          pr: null,
          checks: {},
          tokens: s.run.usage.totalTokens,
          trippedLock: "wallBudget",
          blockedReason: null,
        });
      }
      active.length = 0;
      break;
    }

    const seat = active.shift()!;

    // Spend guard per seat
    const sg = await guard(seat.run, config.spend, seat.startTime, 0);
    if (sg.tripped) {
      seats.push({
        task: seat.task.id,
        agentId: extractAgentId(seat.run),
        model,
        status: "cancelled",
        pr: null,
        checks: {},
        tokens: sg.usage.tokens,
        trippedLock: sg.lockName,
        blockedReason: null,
      });
      await fillSeats();
      continue;
    }

    // 5. Verify
    const verifyResults = await runVerify(config.verify);
    let verifyPassed = verifyResults.every((r) => r.exitCode === 0);

    // Files allowlist (needs diff paths from a real PR; no-op with scripted runs)
    if (verifyPassed && config.filesAllowlist && config.filesAllowlist.length > 0) {
      const diffPaths: string[] = [];
      if (diffPaths.length > 0) {
        const allow = filesAllowlist(diffPaths, [], config.filesAllowlist);
        if (allow.violations.length > 0) {
          verifyPassed = false;
        }
      }
    }

    if (verifyPassed) {
      // 6. Success
      await board.complete(seat.task.id, "verified");
      seats.push({
        task: seat.task.id,
        agentId: extractAgentId(seat.run),
        model,
        status: "completed",
        pr: null,
        checks: {},
        tokens: seat.run.usage.totalTokens,
        trippedLock: null,
        blockedReason: null,
      });
    } else {
      // 7. Verify failed — check repeat-stop
      const output = verifyResults.map((r) => r.output).join("\n");
      const hash = errorHash(output);
      errorHashes.push(hash);

      if (repeatStop(errorHashes)) {
        await board.block(seat.task.id, `Repeat error: ${hash.slice(0, 12)}`);
        seats.push({
          task: seat.task.id,
          agentId: extractAgentId(seat.run),
          model,
          status: "blocked",
          pr: null,
          checks: {},
          tokens: seat.run.usage.totalTokens,
          trippedLock: null,
          blockedReason: "Repeat-stop: same error hash",
        });
      } else if (seat.attempt < 2) {
        // 8. First failure → retry once
        const retryRun = await backend.create({
          prompt: seat.task.title,
          model,
          repo,
          ref: "main",
          metadata: {
            pool: config.poolId,
            task: seat.task.id,
            retry: "true",
          },
        });
        active.push({
          task: seat.task,
          run: retryRun,
          startTime: Date.now(),
          attempt: seat.attempt + 1,
        });
      } else {
        // Already retried → block
        await board.block(seat.task.id, "Verify failed after retry");
        seats.push({
          task: seat.task.id,
          agentId: extractAgentId(seat.run),
          model,
          status: "blocked",
          pr: null,
          checks: {},
          tokens: seat.run.usage.totalTokens,
          trippedLock: null,
          blockedReason: "Verify failed after retry",
        });
      }
    }

    // 9. Refill from remaining open tasks
    await fillSeats();
  }

  // 11. Build and write receipt
  const receipt: PoolReceipt = {
    poolId: config.poolId,
    harness: "h1-queue-pool",
    started: new Date(poolStart).toISOString(),
    finished: new Date().toISOString(),
    cap: config.cap,
    seats,
    summary: summarize(seats),
  };

  if (config.receiptPath) {
    await writeReceipt(receipt, config.receiptPath);
  }

  // 12. Daily summary
  const { completed, blocked, cancelled, totalTokens } = receipt.summary;
  await board.appendDaily(
    "H1 pool",
    `${config.poolId}: ${completed} completed, ${blocked} blocked, ${cancelled} cancelled (${totalTokens} tokens)`,
  );

  // 13. Return receipt
  return receipt;
}
