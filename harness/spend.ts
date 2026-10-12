/**
 * Spend lock guard — cancels agent runs that exceed configured caps.
 *
 * Ported from dogfood-api/scripts/agent-day/run-cursor-day.mjs semantics.
 */

export interface SpendConfig {
  model: string;
  maxSends: number;
  runTimeoutMs: number;
  maxTotalTokens: number;
  wallMs: number;
}

export interface AgentRun {
  usage: { totalTokens: number };
  cancel(): Promise<void>;
}

export interface SpendGuardResult {
  tripped: boolean;
  lockName: string | null;
  usage: { tokens: number; sends: number; elapsedMs: number };
}

/**
 * Check whether a run has exceeded any spend cap.
 * When tripped, calls `run.cancel()` and returns which lock fired.
 */
export async function guard(
  run: AgentRun,
  config: SpendConfig,
  startTime: number,
  sends: number = 0,
): Promise<SpendGuardResult> {
  const now = Date.now();
  const elapsedMs = now - startTime;
  const tokens = run.usage.totalTokens;

  const usage = { tokens, sends, elapsedMs };

  if (tokens > config.maxTotalTokens) {
    await run.cancel();
    return { tripped: true, lockName: "maxTotalTokens", usage };
  }

  if (elapsedMs > config.runTimeoutMs) {
    await run.cancel();
    return { tripped: true, lockName: "runTimeout", usage };
  }

  if (sends > config.maxSends) {
    await run.cancel();
    return { tripped: true, lockName: "maxSends", usage };
  }

  if (elapsedMs > config.wallMs) {
    await run.cancel();
    return { tripped: true, lockName: "wallBudget", usage };
  }

  return { tripped: false, lockName: null, usage };
}
