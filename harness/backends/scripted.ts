/**
 * Scripted backend — deterministic fake for CI.
 * Replays a queue of canned events without calling any API.
 */

import type { AgentRun } from "../spend.js";
import type { AgentBackend, CreateAgentOpts } from "./types.js";

export interface ScriptedEvent {
  type: "pr_created" | "checks_complete" | "run_finished" | "error";
  data: Record<string, unknown>;
}

export interface ScriptedRunConfig {
  agentId: string;
  events: ScriptedEvent[];
  tokens: number;
}

interface CallLogEntry {
  method: string;
  args: unknown[];
}

export class ScriptedRun implements AgentRun {
  private _tokens: number;
  private _cancelled = false;

  constructor(
    public readonly agentId: string,
    public readonly events: ScriptedEvent[],
    tokens: number,
  ) {
    this._tokens = tokens;
  }

  get usage() {
    return { totalTokens: this._tokens };
  }

  get cancelled() {
    return this._cancelled;
  }

  async cancel(): Promise<void> {
    this._cancelled = true;
  }
}

export class ScriptedBackend implements AgentBackend {
  private _runConfigs: ScriptedRunConfig[];
  private _index = 0;
  private _callLog: CallLogEntry[] = [];

  constructor(runConfigs: ScriptedRunConfig[]) {
    this._runConfigs = runConfigs;
  }

  get callLog(): readonly CallLogEntry[] {
    return this._callLog;
  }

  async create(opts: CreateAgentOpts): Promise<ScriptedRun> {
    this._callLog.push({ method: "create", args: [opts] });

    if (this._index >= this._runConfigs.length) {
      throw new Error(
        `ScriptedBackend: no more run configs (requested index ${this._index}, have ${this._runConfigs.length})`,
      );
    }

    const config = this._runConfigs[this._index++];
    return new ScriptedRun(config.agentId, config.events, config.tokens);
  }

  async resume(agentId: string): Promise<ScriptedRun> {
    this._callLog.push({ method: "resume", args: [agentId] });
    const config = this._runConfigs.find((c) => c.agentId === agentId);
    if (!config) {
      throw new Error(`ScriptedBackend: no run config for agent ${agentId}`);
    }
    return new ScriptedRun(config.agentId, config.events, config.tokens);
  }

  async cancel(runId: string): Promise<void> {
    this._callLog.push({ method: "cancel", args: [runId] });
  }
}
