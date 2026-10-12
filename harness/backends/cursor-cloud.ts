// @live-only — no tests; needs a real CURSOR_USER_API_KEY.

/**
 * Cursor Cloud backend — thin wrapper around @cursor/sdk.
 * Reads key from CURSOR_USER_API_KEY env var.
 */

import { Agent } from "@cursor/sdk";
import type { AgentRun } from "../spend.js";
import type { AgentBackend, CreateAgentOpts } from "./types.js";

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
    const agent = await Agent.create({
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

    const run = await agent.run();

    return {
      get usage() {
        return { totalTokens: run.usage?.totalTokens ?? 0 };
      },
      async cancel() {
        await run.cancel();
      },
    };
  }

  async resume(agentId: string): Promise<AgentRun> {
    const agent = await Agent.resume({
      apiKey: this._apiKey,
      agentId,
    });

    const run = await agent.run();

    return {
      get usage() {
        return { totalTokens: run.usage?.totalTokens ?? 0 };
      },
      async cancel() {
        await run.cancel();
      },
    };
  }

  async cancel(runId: string): Promise<void> {
    const agent = await Agent.resume({
      apiKey: this._apiKey,
      agentId: runId,
    });
    const run = await agent.run();
    await run.cancel();
  }
}
