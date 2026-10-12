/**
 * Shared agent backend interface.
 * Every backend (scripted, cursor-cloud, cursor-cli) implements this.
 */

import type { AgentRun } from "../spend.js";

export interface CreateAgentOpts {
  repo: string;
  ref: string;
  prompt: string;
  model: string;
  metadata: Record<string, string>;
  envVars?: Record<string, string>;
  autoCreatePR?: boolean;
}

export interface AgentBackend {
  create(opts: CreateAgentOpts): Promise<AgentRun>;
  resume?(agentId: string): Promise<AgentRun>;
  cancel?(runId: string): Promise<void>;
}
