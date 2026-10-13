/**
 * H4 best-of-N tournament harness.
 *
 * Runs N agents on the same task in parallel, scores each result,
 * and picks the best. This is the tournament / best-of-N pattern.
 *
 * Flow:
 * 1. Launch `n` agents in parallel, all with the same prompt
 * 2. Wait for all to complete
 * 3. For each: run runVerify(verify) — failed verify = score 0
 * 4. For each passing: call scorer(run) to get a 0-100 score
 * 5. Highest score wins. Ties broken by lowest token count.
 * 6. Mark winner as "winner", other passing as "passed", failed as "failed"
 * 7. Write receipt if path provided
 * 8. Return TournamentReceipt
 */

import type { AgentBackend } from "../../harness/backends/types.js";
import type { AgentRun, SpendConfig } from "../../harness/spend.js";
import { runVerify } from "../../harness/gate.js";
import { writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

/* ─── Public types ─── */

export interface Scorer {
  (run: AgentRun): Promise<number>;
}

export interface TournamentConfig {
  tournamentId: string;
  task: string;
  n: number;
  spend: SpendConfig;
  verify: string[];
  scorer: Scorer;
  model?: string;
  repo?: string;
  receiptPath?: string;
}

export interface ContestantResult {
  seatIndex: number;
  agentId: string;
  status: "winner" | "passed" | "failed";
  score: number;
  verifyPassed: boolean;
  durationMs: number;
  tokens: number;
}

export interface TournamentReceipt {
  tournamentId: string;
  task: string;
  n: number;
  contestants: ContestantResult[];
  winnerId: string;
  winnerScore: number;
  totalTokens: number;
  totalDurationMs: number;
}

/* ─── Built-in scorers ─── */

export const scorers = {
  /** All passing contestants score 50; useful when verify is the only gate */
  passOnly: async (_run: AgentRun) => 50,

  /** Score inversely by token usage (fewer tokens = higher score) */
  tokenEfficiency: async (run: AgentRun) => {
    const tokens = run.usage?.totalTokens ?? 0;
    if (tokens === 0) return 50;
    return Math.max(0, Math.min(100, Math.round(100 - tokens / 100)));
  },
};

/* ─── Helpers ─── */

function extractAgentId(run: Record<string, unknown>): string {
  return "agentId" in run ? String(run.agentId) : "";
}

async function writeReceiptFile(receipt: TournamentReceipt, path: string): Promise<void> {
  const tmpPath = join(dirname(path), `.${Date.now()}.tournament-receipt.tmp`);
  const json = JSON.stringify(receipt, null, 2) + "\n";
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}

/* ─── Main tournament runner ─── */

export async function runTournament(
  config: TournamentConfig,
  backend: AgentBackend,
): Promise<TournamentReceipt> {
  const tournamentStart = Date.now();
  const model = config.model ?? config.spend.model;

  // 1. Launch n agents in parallel
  const runPromises = Array.from({ length: config.n }, (_, i) =>
    backend.create({
      prompt: config.task,
      model,
      repo: config.repo ?? "",
      ref: "main",
      metadata: {
        tournament: config.tournamentId,
        seat: String(i),
      },
    }).then((run) => ({ seatIndex: i, run, startTime: Date.now() })),
  );

  // 2. Wait for all to complete
  const runs = await Promise.all(runPromises);

  // 3-4. Verify and score each
  const contestants: ContestantResult[] = [];

  for (const { seatIndex, run } of runs) {
    const seatStart = Date.now();
    const agentId = extractAgentId(run as unknown as Record<string, unknown>);
    const tokens = run.usage?.totalTokens ?? 0;

    // Run verification gates
    const verifyResults = await runVerify(config.verify);
    const verifyPassed = verifyResults.every((r) => r.exitCode === 0);

    let score = 0;
    if (verifyPassed) {
      score = await config.scorer(run);
    }

    contestants.push({
      seatIndex,
      agentId,
      status: "failed", // provisional; updated below
      score,
      verifyPassed,
      durationMs: Date.now() - seatStart,
      tokens,
    });
  }

  // 5-6. Pick the winner: highest score, ties broken by lowest token count
  const passing = contestants.filter((c) => c.verifyPassed);

  let winnerId = "";
  let winnerScore = 0;

  if (passing.length > 0) {
    passing.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.tokens - b.tokens;
    });

    const winner = passing[0];
    winner.status = "winner";
    winnerId = winner.agentId;
    winnerScore = winner.score;

    for (const c of passing.slice(1)) {
      c.status = "passed";
    }
  }

  // Failed contestants keep status "failed"

  const totalTokens = contestants.reduce((sum, c) => sum + c.tokens, 0);

  const receipt: TournamentReceipt = {
    tournamentId: config.tournamentId,
    task: config.task,
    n: config.n,
    contestants,
    winnerId,
    winnerScore,
    totalTokens,
    totalDurationMs: Date.now() - tournamentStart,
  };

  // 7. Write receipt if path provided
  if (config.receiptPath) {
    await writeReceiptFile(receipt, config.receiptPath);
  }

  // 8. Return
  return receipt;
}
