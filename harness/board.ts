/**
 * Board — obsidian-mcp client for vault-backed task management.
 *
 * Stub: the full implementation spawns obsidian-mcp over stdio (MCP SDK client).
 * This file defines the interface so other modules can import it.
 * F3 will implement the real version.
 */

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
}

/**
 * Create a board backed by obsidian-mcp over stdio.
 *
 * TODO (F3): implement using @modelcontextprotocol/sdk stdio transport.
 * Requires OBSIDIAN_VAULT_PATH to be set.
 */
export function createBoard(_vaultPath: string): Board {
  throw new Error(
    "board.ts is a stub — F3 implements the obsidian-mcp stdio client. " +
    "Use ScriptedBackend for offline testing.",
  );
}
