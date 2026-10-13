/**
 * Cursor CLI backend — wraps `cursor agent -p --output-format stream-json`.
 * Spawns the CLI as a child process and parses NDJSON from stdout.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentRun } from "../spend.js";
import type { AgentBackend, CreateAgentOpts } from "./types.js";

export interface CliEvent {
  type: "message" | "tool_call" | "tool_result" | "usage" | "result";
  name?: string;
  content?: string;
  arguments?: Record<string, unknown>;
  totalTokens?: number;
  usage?: { totalTokens: number };
}

export class CursorCliRun implements AgentRun {
  private _process: ChildProcess;
  private _tokens = 0;
  private _events: CliEvent[] = [];
  private _done: Promise<void>;
  private _resultContent: string | undefined;

  constructor(proc: ChildProcess) {
    this._process = proc;

    this._done = new Promise<void>((resolve, reject) => {
      let exitCode: number | null = null;
      let processExited = false;
      let rlClosed = false;

      const rl = createInterface({ input: proc.stdout! });

      rl.on("line", (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let event: CliEvent;
        try {
          event = JSON.parse(trimmed) as CliEvent;
        } catch {
          return;
        }

        this._events.push(event);

        if (event.type === "usage" && typeof event.totalTokens === "number") {
          this._tokens = event.totalTokens;
        }

        if (event.type === "result") {
          this._resultContent = event.content;
          if (event.usage && typeof event.usage.totalTokens === "number") {
            this._tokens = event.usage.totalTokens;
          }
        }
      });

      const maybeSettle = () => {
        if (!processExited || !rlClosed) return;
        if (exitCode !== 0 && exitCode !== null) {
          reject(new Error(`cursor agent exited with code ${exitCode}`));
        } else {
          resolve();
        }
      };

      rl.on("close", () => {
        rlClosed = true;
        maybeSettle();
      });

      proc.on("close", (code) => {
        exitCode = code;
        processExited = true;
        maybeSettle();
      });

      proc.on("error", (err) => {
        rl.close();
        reject(err);
      });
    });
  }

  get usage() {
    return { totalTokens: this._tokens };
  }

  get events(): readonly CliEvent[] {
    return this._events;
  }

  get resultContent(): string | undefined {
    return this._resultContent;
  }

  async cancel(): Promise<void> {
    this._process.kill("SIGTERM");
  }

  async wait(): Promise<void> {
    return this._done;
  }
}

export class CursorCliBackend implements AgentBackend {
  private _cliPath: string;

  constructor(cliPath: string = "cursor") {
    this._cliPath = cliPath;
  }

  async create(opts: CreateAgentOpts): Promise<CursorCliRun> {
    const args = ["agent", "-p", opts.prompt, "--output-format", "stream-json"];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (opts.envVars) {
      Object.assign(env, opts.envVars);
    }

    const proc = spawn(this._cliPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    return new CursorCliRun(proc);
  }
}
