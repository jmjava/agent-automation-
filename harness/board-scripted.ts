/**
 * ScriptedBoard — in-memory Board implementation for tests and dry-runs.
 *
 * Pre-load it with tasks; every method records to `callLog` so assertions
 * can verify the sequence of board interactions without a live vault.
 */

import type { Board, TaskItem } from "./board.js";

export interface BoardCall {
  method: string;
  args: unknown[];
}

export class ScriptedBoard implements Board {
  private _tasks: TaskItem[];
  private _callLog: BoardCall[] = [];

  constructor(tasks: TaskItem[] = []) {
    this._tasks = [...tasks];
  }

  /** Recorded calls in order. */
  get callLog(): readonly BoardCall[] {
    return this._callLog;
  }

  /** Snapshot of current task list. */
  get tasks(): readonly TaskItem[] {
    return this._tasks;
  }

  async listOpen(project: string): Promise<TaskItem[]> {
    this._callLog.push({ method: "listOpen", args: [project] });
    return this._tasks.filter((t) => t.project === project);
  }

  async claim(project: string, text: string): Promise<TaskItem> {
    this._callLog.push({ method: "claim", args: [project, text] });
    const idx = this._tasks.findIndex(
      (t) => t.project === project && t.title === text,
    );
    if (idx === -1) {
      throw new Error(`ScriptedBoard: no task matching "${text}" in project "${project}"`);
    }
    return this._tasks.splice(idx, 1)[0];
  }

  async complete(id: string, summary: string): Promise<void> {
    this._callLog.push({ method: "complete", args: [id, summary] });
  }

  async block(id: string, reason: string): Promise<void> {
    this._callLog.push({ method: "block", args: [id, reason] });
  }

  async unblock(id: string): Promise<void> {
    this._callLog.push({ method: "unblock", args: [id] });
  }

  async appendDaily(heading: string, text: string): Promise<void> {
    this._callLog.push({ method: "appendDaily", args: [heading, text] });
  }

  async close(): Promise<void> {
    this._callLog.push({ method: "close", args: [] });
  }
}
