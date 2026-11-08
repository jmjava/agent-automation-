// @live-only — no tests; needs a real CURSOR_USER_API_KEY.

/**
 * Cursor Cloud backend — thin wrapper around @cursor/sdk.
 * Reads key from CURSOR_USER_API_KEY env var.
 */

import { Agent } from "@cursor/sdk";
import type { AgentRun } from "../spend.js";
import type { AgentBackend, CreateAgentOpts } from "./types.js";

interface CloudRun {
  usage?: { totalTokens?: number };
  cancel(): Promise<void>;
}

interface CloudAgent {
  run(): Promise<CloudRun>;
}

type CloudCreate = (options: {
  apiKey: string;
  prompt: string;
  cloud: {
    repository: string;
    ref: string;
    metadata: Record<string, string>;
    envVars?: Record<string, string>;
    autoCreatePR?: boolean;
  };
}) => Promise<CloudAgent>;

type CloudResume = (options: { apiKey: string; agentId: string }) => Promise<CloudAgent>;

const createCloudAgent = Agent.create as unknown as CloudCreate;
const resumeCloudAgent = Agent.resume as unknown as CloudResume;

function toAgentRun(run: CloudRun): AgentRun {
  return {
    get usage() {
      return { totalTokens: run.usage?.totalTokens ?? 0 };
    },
    async cancel() {
      await run.cancel();
    },
  };
}

export class CursorCloudBackend implements AgentBackend {
  private _apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.CURSOR_USER_API_KEY;
    if (!key) {
      throw new Error(
        "CursorCloudBackend: no API key. Set CURSOR_USER_API_KEY or pass it to the constructor.",
      );
    }
    if (key.startsWith("sk-proj-")) {
      throw new Error(
        "CursorCloudBackend: sk-proj-* keys are OpenAI project keys, not Cursor user keys. " +
        "Use a Cursor user API key from Settings → API Keys.",
      );
    }
    this._apiKey = key;
  }

  async create(opts: CreateAgentOpts): Promise<AgentRun> {
    const agent = await createCloudAgent({
      apiKey: this._apiKey,
      prompt: opts.prompt,
      cloud: {
        repository: opts.repo,
        ref: opts.ref,
        metadata: opts.metadata,
        envVars: opts.envVars,
        autoCreatePR: opts.autoCreatePR,
      },
    });

    return toAgentRun(await agent.run());
  }

  async resume(agentId: string): Promise<AgentRun> {
    const agent = await resumeCloudAgent({
      apiKey: this._apiKey,
      agentId,
    });

    return toAgentRun(await agent.run());
  }

  async cancel(runId: string): Promise<void> {
    const agent = await resumeCloudAgent({
      apiKey: this._apiKey,
      agentId: runId,
    });
    const run = await agent.run();
    await run.cancel();
  }
}
