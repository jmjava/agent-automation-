/**
 * H5 router-tiers coordinator.
 *
 * Routes tasks to different model tiers based on a classifier function,
 * and escalates to more expensive tiers on verification failure.
 *
 * Flow:
 * 1. For each task: call classifier(task) to get the tier name
 * 2. Find the tier config. Launch agent with that tier's model.
 * 3. Run verify. If passes → success.
 * 4. If fails: escalate to the next more expensive tier (if one exists).
 * 5. If the most expensive tier also fails → mark as failed.
 * 6. Record tier breakdown stats.
 * 7. Write receipt.
 */

import type { AgentBackend } from "../../harness/backends/types.js";
import type { AgentRun, SpendConfig } from "../../harness/spend.js";
import { runVerify } from "../../harness/gate.js";
import { writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

/* ─── Public types ─── */

export interface TierConfig {
  name: string;
  model: string;
  maxTokens?: number;
}

export interface Classifier {
  (task: string): Promise<string>;
}

export interface RouterConfig {
  routerId: string;
  tiers: TierConfig[];
  classifier: Classifier;
  spend: SpendConfig;
  verify: string[];
  repo?: string;
  receiptPath?: string;
}

export interface RoutedResult {
  task: string;
  tier: string;
  status: "success" | "failed" | "escalated";
  finalTier?: string;
  agentId: string;
  tokens: number;
  durationMs: number;
}

export interface RouterReceipt {
  routerId: string;
  results: RoutedResult[];
  tierBreakdown: Record<string, { count: number; tokens: number; successes: number }>;
  escalations: number;
  totalTokens: number;
  totalDurationMs: number;
}

/* ─── Built-in classifiers ─── */

export const classifiers = {
  /** Always routes to the first (cheapest) tier */
  alwaysCheap: async (_task: string) => "fast",

  /** Routes based on task length: short=fast, medium=standard, long=premium */
  byLength:
    (thresholds: { short: number; medium: number }) =>
    async (task: string): Promise<string> => {
      if (task.length < thresholds.short) return "fast";
      if (task.length < thresholds.medium) return "standard";
      return "premium";
    },

  /** Routes based on keywords */
  byKeyword:
    (keywords: Record<string, string[]>) =>
    async (task: string): Promise<string> => {
      const lower = task.toLowerCase();
      for (const [tier, words] of Object.entries(keywords)) {
        if (words.some((w) => lower.includes(w))) return tier;
      }
      return Object.keys(keywords)[0];
    },
};

/* ─── Helpers ─── */

function extractAgentId(run: Record<string, unknown>): string {
  return "agentId" in run ? String(run.agentId) : "";
}

async function writeReceiptFile(receipt: RouterReceipt, path: string): Promise<void> {
  const tmpPath = join(dirname(path), `.${Date.now()}.router-receipt.tmp`);
  const json = JSON.stringify(receipt, null, 2) + "\n";
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}

function findTierIndex(tiers: TierConfig[], name: string): number {
  return tiers.findIndex((t) => t.name === name);
}

/* ─── Main router runner ─── */

export async function runRouter(
  config: RouterConfig,
  tasks: string[],
  backend: AgentBackend,
): Promise<RouterReceipt> {
  const routerStart = Date.now();
  const results: RoutedResult[] = [];
  let escalations = 0;

  const breakdown: Record<string, { count: number; tokens: number; successes: number }> = {};
  for (const tier of config.tiers) {
    breakdown[tier.name] = { count: 0, tokens: 0, successes: 0 };
  }

  for (const task of tasks) {
    const taskStart = Date.now();
    const classifiedTier = await config.classifier(task);
    let tierIndex = findTierIndex(config.tiers, classifiedTier);

    if (tierIndex === -1) {
      tierIndex = 0;
    }

    let currentTierIndex = tierIndex;
    let finalStatus: "success" | "failed" | "escalated" = "failed";
    let finalAgentId = "";
    let totalTaskTokens = 0;
    let finalTier: string | undefined;
    const initialTier = config.tiers[currentTierIndex].name;

    while (currentTierIndex < config.tiers.length) {
      const tier = config.tiers[currentTierIndex];

      const run: AgentRun = await backend.create({
        prompt: task,
        model: tier.model,
        repo: config.repo ?? "",
        ref: "main",
        metadata: {
          router: config.routerId,
          tier: tier.name,
          task,
        },
      });

      const agentId = extractAgentId(run as unknown as Record<string, unknown>);
      const tokens = run.usage?.totalTokens ?? 0;
      totalTaskTokens += tokens;

      breakdown[tier.name].count++;
      breakdown[tier.name].tokens += tokens;

      const verifyResults = await runVerify(config.verify);
      const verifyPassed = verifyResults.every((r) => r.exitCode === 0);

      if (verifyPassed) {
        finalStatus = currentTierIndex > tierIndex ? "escalated" : "success";
        finalAgentId = agentId;
        finalTier = currentTierIndex > tierIndex ? tier.name : undefined;
        breakdown[tier.name].successes++;
        break;
      }

      currentTierIndex++;
    }

    if (finalStatus === "failed") {
      const lastTier = config.tiers[config.tiers.length - 1];
      finalAgentId = finalAgentId || extractAgentId({} as Record<string, unknown>);
      finalTier = lastTier.name !== initialTier ? lastTier.name : undefined;
    }

    results.push({
      task,
      tier: initialTier,
      status: finalStatus,
      finalTier,
      agentId: finalAgentId,
      tokens: totalTaskTokens,
      durationMs: Date.now() - taskStart,
    });
  }

  const totalTokens = results.reduce((sum, r) => sum + r.tokens, 0);
  escalations = results.filter((r) => r.status === "escalated" || (r.status === "failed" && r.finalTier !== undefined)).length;

  const receipt: RouterReceipt = {
    routerId: config.routerId,
    results,
    tierBreakdown: breakdown,
    escalations,
    totalTokens,
    totalDurationMs: Date.now() - routerStart,
  };

  if (config.receiptPath) {
    await writeReceiptFile(receipt, config.receiptPath);
  }

  return receipt;
}
