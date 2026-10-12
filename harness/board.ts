/**
 * Board — obsidian-mcp client for vault-backed task management.
 *
 * Connects to the obsidian-dev-memory MCP server over stdio using the
 * official @modelcontextprotocol/sdk client. The connection is lazy:
 * it is established on the first call, not at construction time.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface TaskItem {
  id: string;
  title: string;
  project: string;
  category?: string;
  metadata?: Record<string, string>;
}

export interface Board {
  listOpen(project: string): Promise<TaskItem[]>;
  claim(project: string, text: string): Promise<TaskItem>;
  complete(id: string, summary: string): Promise<void>;
  block(id: string, reason: string): Promise<void>;
  unblock(id: string): Promise<void>;
  appendDaily(heading: string, text: string): Promise<void>;
  /** Disconnect the stdio transport. Safe to call multiple times. */
  close(): Promise<void>;
}

interface McpTextContent {
  type: string;
  text: string;
}

/**
 * Create a board backed by obsidian-mcp over stdio.
 *
 * The MCP server is spawned as a child process on the first tool call.
 * Pass the vault path (e.g. `/home/ubuntu/obsidian-notes`).
 */
export function createBoard(vaultPath: string): Board {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  async function ensureConnected(): Promise<Client> {
    if (client) return client;

    transport = new StdioClientTransport({
      command: "uv",
      args: [
        "--directory",
        "/home/ubuntu/github/jmjava/obsidian-mcp",
        "run",
        "python",
        "-m",
        "obsidian_dev_memory",
      ],
      env: {
        ...process.env,
        OBSIDIAN_VAULT_PATH: vaultPath,
        OBSIDIAN_MEMORY_ROOT: "AI Memory",
      },
    });

    client = new Client({ name: "agent-automation-board", version: "0.1.0" });
    await client.connect(transport);
    return client;
  }

  async function callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const c = await ensureConnected();
    const result = await c.callTool({ name, arguments: args });

    const textItem = (
      result.content as McpTextContent[] | undefined
    )?.find((item) => item.type === "text");
    if (textItem) {
      try {
        return JSON.parse(textItem.text);
      } catch {
        return textItem.text;
      }
    }
    return result;
  }

  return {
    async listOpen(project) {
      const result = await callTool("list_open_tasks", { project });
      if (!Array.isArray(result)) return [];
      return (result as Record<string, unknown>[]).map((item) => ({
        id: String(item.id ?? item.title ?? ""),
        title: String(item.title ?? item.text ?? ""),
        project,
        category: item.category != null ? String(item.category) : undefined,
        metadata:
          item.metadata != null
            ? (item.metadata as Record<string, string>)
            : undefined,
      }));
    },

    async claim(project, text) {
      const result = await callTool("claim_task", { project, text });
      if (result && typeof result === "object" && "title" in (result as object)) {
        const r = result as Record<string, unknown>;
        return {
          id: String(r.id ?? text),
          title: String(r.title ?? text),
          project,
          category: r.category != null ? String(r.category) : undefined,
          metadata: r.metadata as Record<string, string> | undefined,
        };
      }
      return { id: text, title: text, project };
    },

    async complete(id, summary) {
      await callTool("complete_task", { project: "agent-automation", text: id, summary });
    },

    async block(id, reason) {
      await callTool("block_task", {
        project: "agent-automation",
        text: id,
        reason,
      });
    },

    async unblock(id) {
      await callTool("unblock_task", { project: "agent-automation", text: id });
    },

    async appendDaily(heading, text) {
      await callTool("append_daily_note", { heading, text });
    },

    async close() {
      if (transport) {
        await transport.close();
        transport = null;
        client = null;
      }
    },
  };
}
