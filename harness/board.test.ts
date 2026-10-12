import { describe, it, expect } from "vitest";
import { createBoard } from "./board.js";
import { ScriptedBoard } from "./board-scripted.js";
import type { TaskItem } from "./board.js";

/* ─── createBoard (lazy connection) ─── */

describe("createBoard", () => {
  it("returns a Board object without connecting immediately", () => {
    const board = createBoard("/tmp/non-existent-vault");
    expect(board).toBeDefined();
    expect(typeof board.listOpen).toBe("function");
    expect(typeof board.claim).toBe("function");
    expect(typeof board.complete).toBe("function");
    expect(typeof board.block).toBe("function");
    expect(typeof board.unblock).toBe("function");
    expect(typeof board.appendDaily).toBe("function");
    expect(typeof board.close).toBe("function");
  });
});

/* ─── ScriptedBoard ─── */

const seed: TaskItem[] = [
  { id: "t1", title: "Fix login", project: "alpha" },
  { id: "t2", title: "Add tests", project: "alpha" },
  { id: "t3", title: "Deploy v2", project: "beta" },
];

describe("ScriptedBoard", () => {
  it("listOpen filters by project", async () => {
    const board = new ScriptedBoard(seed);
    const alphaItems = await board.listOpen("alpha");
    expect(alphaItems).toHaveLength(2);
    expect(alphaItems.map((t) => t.id)).toEqual(["t1", "t2"]);

    const betaItems = await board.listOpen("beta");
    expect(betaItems).toHaveLength(1);
    expect(betaItems[0].title).toBe("Deploy v2");
  });

  it("claim removes the task from the internal list", async () => {
    const board = new ScriptedBoard(seed);
    const claimed = await board.claim("alpha", "Fix login");
    expect(claimed.id).toBe("t1");
    expect(board.tasks).toHaveLength(2);
    expect(board.tasks.find((t) => t.id === "t1")).toBeUndefined();
  });

  it("claim throws when no matching task exists", async () => {
    const board = new ScriptedBoard(seed);
    await expect(board.claim("alpha", "Nonexistent")).rejects.toThrowError(
      /no task matching/i,
    );
  });

  it("claim requires matching project", async () => {
    const board = new ScriptedBoard(seed);
    await expect(board.claim("beta", "Fix login")).rejects.toThrowError(
      /no task matching/i,
    );
  });

  it("complete records the call", async () => {
    const board = new ScriptedBoard();
    await board.complete("t1", "done");
    expect(board.callLog).toEqual([
      { method: "complete", args: ["t1", "done"] },
    ]);
  });

  it("block records the call", async () => {
    const board = new ScriptedBoard();
    await board.block("t1", "waiting on upstream");
    expect(board.callLog).toEqual([
      { method: "block", args: ["t1", "waiting on upstream"] },
    ]);
  });

  it("unblock records the call", async () => {
    const board = new ScriptedBoard();
    await board.unblock("t1");
    expect(board.callLog).toEqual([{ method: "unblock", args: ["t1"] }]);
  });

  it("appendDaily records the call", async () => {
    const board = new ScriptedBoard();
    await board.appendDaily("## Status", "All green");
    expect(board.callLog).toEqual([
      { method: "appendDaily", args: ["## Status", "All green"] },
    ]);
  });

  it("preserves full call sequence", async () => {
    const board = new ScriptedBoard(seed);
    await board.listOpen("alpha");
    await board.claim("alpha", "Fix login");
    await board.complete("t1", "shipped");
    await board.appendDaily("## Done", "Finished t1");

    expect(board.callLog.map((c) => c.method)).toEqual([
      "listOpen",
      "claim",
      "complete",
      "appendDaily",
    ]);
  });
});
