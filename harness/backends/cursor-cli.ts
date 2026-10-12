/**
 * Cursor CLI backend — wraps `cursor agent -p --output-format stream-json`.
 * For in-VM local agent runs.
 *
 * TODO: implement NDJSON stream parsing and AgentRun wrapping.
 */

import type { AgentRun } from "../spend.js";
import type { AgentBackend, CreateAgentOpts } from "./types.js";

export class CursorCliBackend implements AgentBackend {
  async create(_opts: CreateAgentOpts): Promise<AgentRun> {
    throw new Error("CursorCliBackend: not yet implemented (F8)");
  }
}
