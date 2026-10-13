/**
 * H3 pipeline-gates coordinator.
 *
 * Implements a sequential multi-stage pipeline where each stage has a
 * verification gate that must pass before the next stage starts.
 *
 * Flow:
 * 1. For each stage in order:
 *    a. Build prompt from stage.prompt with {task} replaced by config.task
 *    b. Create an agent run via the backend
 *    c. Wait for run to complete
 *    d. Run runVerify(stage.verify) — if fails, mark stage failed and STOP
 *    e. If stage.filesAllowlist, run filesAllowlist() — if fails, STOP
 *    f. Record StageResult
 * 2. If all stages pass: finalStatus = "success"
 * 3. If any stage fails: remaining stages are "skipped", finalStatus = "failed"
 * 4. Optionally write receipt to receiptPath
 * 5. Return PipelineReceipt
 */

import type { AgentBackend } from "../../harness/backends/types.js";
import type { SpendConfig } from "../../harness/spend.js";
import { runVerify, filesAllowlist } from "../../harness/gate.js";
import { writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

/* ─── Public types ─── */

export interface PipelineStage {
  name: string;
  prompt: string;
  verify: string[];
  filesAllowlist?: string[];
  model?: string;
}

export interface PipelineConfig {
  pipelineId: string;
  task: string;
  stages: PipelineStage[];
  spend: SpendConfig;
  repo?: string;
  receiptPath?: string;
}

export interface StageResult {
  stage: string;
  status: "success" | "failed" | "skipped";
  agentId?: string;
  error?: string;
  durationMs: number;
}

export interface PipelineReceipt {
  pipelineId: string;
  task: string;
  stages: StageResult[];
  totalDurationMs: number;
  totalTokens: number;
  finalStatus: "success" | "failed";
}

/* ─── Default stages factory ─── */

export function defaultStages(
  overrides?: Partial<Record<string, Partial<PipelineStage>>>,
): PipelineStage[] {
  return [
    {
      name: "plan",
      prompt: "Create a plan for: {task}",
      verify: ["echo ok"],
      ...overrides?.plan,
    },
    {
      name: "implement",
      prompt: "Implement the plan for: {task}",
      verify: ["npm test"],
      ...overrides?.implement,
    },
    {
      name: "verify",
      prompt: "Review and fix any issues for: {task}",
      verify: ["npm test", "npm run lint"],
      ...overrides?.verify,
    },
    {
      name: "review",
      prompt: "Final review of: {task}",
      verify: ["echo ok"],
      ...overrides?.review,
    },
  ];
}

/* ─── Helpers ─── */

function extractAgentId(run: { agentId?: string } & Record<string, unknown>): string {
  return "agentId" in run ? String(run.agentId) : "";
}

async function writeReceiptFile(receipt: PipelineReceipt, path: string): Promise<void> {
  const tmpPath = join(dirname(path), `.${Date.now()}.pipeline-receipt.tmp`);
  const json = JSON.stringify(receipt, null, 2) + "\n";
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}

/* ─── Main pipeline runner ─── */

export async function runPipeline(
  config: PipelineConfig,
  backend: AgentBackend,
): Promise<PipelineReceipt> {
  const pipelineStart = Date.now();
  const results: StageResult[] = [];
  let totalTokens = 0;
  let failed = false;

  for (let i = 0; i < config.stages.length; i++) {
    const stage = config.stages[i];

    if (failed) {
      results.push({
        stage: stage.name,
        status: "skipped",
        durationMs: 0,
      });
      continue;
    }

    const stageStart = Date.now();
    const prompt = stage.prompt.replace(/\{task\}/g, config.task);
    const model = stage.model ?? config.spend.model;

    const run = await backend.create({
      prompt,
      model,
      repo: config.repo ?? "",
      ref: "main",
      metadata: {
        pipeline: config.pipelineId,
        stage: stage.name,
      },
    });

    const agentId = extractAgentId(run as Record<string, unknown>);
    totalTokens += run.usage.totalTokens;

    // Gate: run verification commands
    const verifyResults = await runVerify(stage.verify);
    const verifyPassed = verifyResults.every((r) => r.exitCode === 0);

    if (!verifyPassed) {
      const failedCmd = verifyResults.find((r) => r.exitCode !== 0);
      results.push({
        stage: stage.name,
        status: "failed",
        agentId,
        error: `Verify failed: ${failedCmd?.command} (exit ${failedCmd?.exitCode})`,
        durationMs: Date.now() - stageStart,
      });
      failed = true;
      continue;
    }

    // Gate: files allowlist
    if (stage.filesAllowlist && stage.filesAllowlist.length > 0) {
      const diffPaths: string[] = [];
      if ("diffPaths" in run && Array.isArray((run as Record<string, unknown>).diffPaths)) {
        diffPaths.push(...(run as { diffPaths: string[] }).diffPaths);
      }

      if (diffPaths.length > 0) {
        const allow = filesAllowlist(diffPaths, stage.filesAllowlist, ["**/*.test.*", "**/__tests__/**"]);
        if (allow.violations.length > 0) {
          results.push({
            stage: stage.name,
            status: "failed",
            agentId,
            error: `Files allowlist violation: ${allow.violations.join(", ")}`,
            durationMs: Date.now() - stageStart,
          });
          failed = true;
          continue;
        }
      }
    }

    results.push({
      stage: stage.name,
      status: "success",
      agentId,
      durationMs: Date.now() - stageStart,
    });
  }

  const receipt: PipelineReceipt = {
    pipelineId: config.pipelineId,
    task: config.task,
    stages: results,
    totalDurationMs: Date.now() - pipelineStart,
    totalTokens,
    finalStatus: failed ? "failed" : "success",
  };

  if (config.receiptPath) {
    await writeReceiptFile(receipt, config.receiptPath);
  }

  return receipt;
}
