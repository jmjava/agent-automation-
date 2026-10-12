/**
 * H1 queue-pool coordinator.
 *
 * Implements the 6-step pool behavior:
 * 1. List open tasks from the board
 * 2. Claim up to `cap` tasks
 * 3. Launch one agent per claimed task
 * 4. Wait for each agent run; read PR checks
 * 5. Complete or block each task based on results
 * 6. Refill: when a seat exits, claim the next open task
 *
 * Board integration is stubbed (TODO: F3 board.ts).
 * Use ScriptedBackend for offline testing.
 */

import { guard, type SpendConfig, type AgentRun } from "../../harness/spend.js";
import { errorHash, repeatStop } from "../../harness/gate.js";
import { writeReceipt, summarize, type PoolReceipt, type SeatResult } from "../../harness/receipt.js";
import type { AgentBackend, CreateAgentOpts } from "../../harness/backends/types.js";

export interface PoolConfig {
  cap: number;
  spend: SpendConfig;
  backend: AgentBackend;
  receiptPath: string;
}

export interface TaskEntry {
  id: string;
  title: string;
  repo: string;
  ref: string;
  model: string;
  prompt: string;
  files: string[];
  testGlobs: string[];
  verifyCommands: string[];
}

/**
 * Run the queue-pool coordinator.
 *
 * @param tasks - ordered list of tasks to process
 * @param config - pool configuration
 * @returns the pool receipt
 */
export async function runPool(
  tasks: TaskEntry[],
  config: PoolConfig,
): Promise<PoolReceipt> {
  const startTime = Date.now();
  const poolId = `pool-${Date.now()}`;
  const seatResults: SeatResult[] = [];
  const errorHistory: string[] = [];

  // Rule of 3: refuse to fan out with fewer than 3 independent tasks
  if (tasks.length < 3) {
    console.warn(
      `Rule of 3: only ${tasks.length} tasks provided (minimum 3). ` +
      "Recording all as blocked in receipt.",
    );
    for (const task of tasks) {
      seatResults.push({
        task: task.id,
        agentId: "",
        model: task.model,
        status: "blocked",
        pr: null,
        checks: {},
        tokens: 0,
        trippedLock: null,
        blockedReason: `Rule of 3: only ${tasks.length} tasks (need ≥ 3)`,
      });
    }
  } else {
    const taskQueue = [...tasks];
    const activeSeats: Map<string, { task: TaskEntry; run: AgentRun; startTime: number; sends: number }> = new Map();

    // Step 1-3: Fill initial seats
    while (activeSeats.size < config.cap && taskQueue.length > 0) {
      const task = taskQueue.shift()!;
      // TODO: board.claim(project, task.title)

      const opts: CreateAgentOpts = {
        repo: task.repo,
        ref: task.ref,
        prompt: task.prompt,
        model: task.model,
        metadata: { pool: poolId, task: task.id },
        autoCreatePR: true,
      };

      try {
        const run = await config.backend.create(opts);
        activeSeats.set(task.id, { task, run, startTime: Date.now(), sends: 0 });
      } catch (err) {
        seatResults.push({
          task: task.id,
          agentId: "",
          model: task.model,
          status: "blocked",
          pr: null,
          checks: {},
          tokens: 0,
          trippedLock: null,
          blockedReason: `Failed to create agent: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Step 4-6: Process seats and refill
    for (const [taskId, seat] of activeSeats) {
      // Check spend guard
      const spendResult = await guard(
        seat.run,
        config.spend,
        seat.startTime,
        seat.sends,
      );

      if (spendResult.tripped) {
        seatResults.push({
          task: taskId,
          agentId: "",
          model: seat.task.model,
          status: "cancelled",
          pr: null,
          checks: {},
          tokens: spendResult.usage.tokens,
          trippedLock: spendResult.lockName,
          blockedReason: null,
        });
        // TODO: board.block(taskId, `Spend lock tripped: ${spendResult.lockName}`)
        continue;
      }

      // Check for repeat-stop
      const hash = errorHash(JSON.stringify(spendResult.usage));
      errorHistory.push(hash);
      if (repeatStop(errorHistory)) {
        seatResults.push({
          task: taskId,
          agentId: "",
          model: seat.task.model,
          status: "blocked",
          pr: null,
          checks: {},
          tokens: spendResult.usage.tokens,
          trippedLock: null,
          blockedReason: "Repeat-stop: same error hash twice",
        });
        continue;
      }

      // TODO: read PR checks, verify all success
      // TODO: board.complete() or board.block()
      seatResults.push({
        task: taskId,
        agentId: "",
        model: seat.task.model,
        status: "completed",
        pr: null,
        checks: {},
        tokens: spendResult.usage.tokens,
        trippedLock: null,
        blockedReason: null,
      });
    }
  }

  const receipt: PoolReceipt = {
    poolId,
    harness: "h1-queue-pool",
    started: new Date(startTime).toISOString(),
    finished: new Date().toISOString(),
    cap: config.cap,
    seats: seatResults,
    summary: summarize(seatResults),
  };

  await writeReceipt(receipt, config.receiptPath);

  return receipt;
}
