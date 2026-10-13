import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter, Readable } from "node:stream";
import { CursorCliRun, CursorCliBackend, type CliEvent } from "./cursor-cli.js";

function createFakeProcess() {
  const stdout = new Readable({ read() {} });
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable | null;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = stdout;
  proc.stderr = null;
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

function pushLine(proc: ReturnType<typeof createFakeProcess>, obj: CliEvent) {
  proc.stdout.push(JSON.stringify(obj) + "\n");
}

function closeProcess(proc: ReturnType<typeof createFakeProcess>, code: number = 0) {
  proc.stdout.push(null);
  proc.emit("close", code);
}

describe("CursorCliRun", () => {
  it("parses message events from NDJSON", async () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    pushLine(proc, { type: "message", content: "Hello world" });
    pushLine(proc, { type: "message", content: "Working on it..." });
    closeProcess(proc);

    await run.wait();

    expect(run.events).toHaveLength(2);
    expect(run.events[0]).toEqual({ type: "message", content: "Hello world" });
    expect(run.events[1]).toEqual({ type: "message", content: "Working on it..." });
  });

  it("tracks tokens from usage events", async () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    pushLine(proc, { type: "usage", totalTokens: 1000 });
    pushLine(proc, { type: "usage", totalTokens: 2500 });
    closeProcess(proc);

    await run.wait();

    expect(run.usage.totalTokens).toBe(2500);
  });

  it("extracts tokens and content from result event", async () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    pushLine(proc, { type: "message", content: "Starting..." });
    pushLine(proc, {
      type: "result",
      content: "Done! Fixed the bug.",
      usage: { totalTokens: 5000 },
    });
    closeProcess(proc);

    await run.wait();

    expect(run.usage.totalTokens).toBe(5000);
    expect(run.resultContent).toBe("Done! Fixed the bug.");
    expect(run.events).toHaveLength(2);
  });

  it("records tool_call and tool_result events", async () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    pushLine(proc, {
      type: "tool_call",
      name: "read_file",
      arguments: { path: "/src/main.ts" },
    });
    pushLine(proc, {
      type: "tool_result",
      name: "read_file",
      content: "export function main() {}",
    });
    closeProcess(proc);

    await run.wait();

    expect(run.events).toHaveLength(2);
    expect(run.events[0].type).toBe("tool_call");
    expect(run.events[0].name).toBe("read_file");
    expect(run.events[1].type).toBe("tool_result");
    expect(run.events[1].content).toBe("export function main() {}");
  });

  it("ignores blank lines and invalid JSON", async () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    proc.stdout.push("\n");
    proc.stdout.push("   \n");
    proc.stdout.push("not json at all\n");
    pushLine(proc, { type: "message", content: "valid" });
    closeProcess(proc);

    await run.wait();

    expect(run.events).toHaveLength(1);
    expect(run.events[0].content).toBe("valid");
  });

  it("cancel sends SIGTERM to the process", async () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    await run.cancel();

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

    closeProcess(proc);
    await run.wait();
  });

  it("rejects when process exits with non-zero code", async () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    pushLine(proc, { type: "message", content: "starting" });
    proc.stdout.push(null);
    proc.emit("close", 1);

    await expect(run.wait()).rejects.toThrow(/exited with code 1/);
  });

  it("rejects when process emits error", async () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    proc.emit("error", new Error("spawn ENOENT"));

    await expect(run.wait()).rejects.toThrow("spawn ENOENT");
  });

  it("starts with zero tokens", () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    expect(run.usage.totalTokens).toBe(0);
    expect(run.events).toHaveLength(0);
    expect(run.resultContent).toBeUndefined();

    closeProcess(proc);
  });

  it("handles full NDJSON session", async () => {
    const proc = createFakeProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = new CursorCliRun(proc as any);

    pushLine(proc, { type: "message", content: "Reading the codebase..." });
    pushLine(proc, {
      type: "tool_call",
      name: "edit_file",
      arguments: { path: "src/fix.ts", content: "fixed" },
    });
    pushLine(proc, {
      type: "tool_result",
      name: "edit_file",
      content: "File written",
    });
    pushLine(proc, { type: "usage", totalTokens: 3000 });
    pushLine(proc, { type: "message", content: "Running tests..." });
    pushLine(proc, { type: "usage", totalTokens: 4500 });
    pushLine(proc, {
      type: "result",
      content: "All done!",
      usage: { totalTokens: 5200 },
    });
    closeProcess(proc);

    await run.wait();

    expect(run.events).toHaveLength(7);
    expect(run.usage.totalTokens).toBe(5200);
    expect(run.resultContent).toBe("All done!");
  });
});

describe("CursorCliBackend", () => {
  let spawnMock: ReturnType<typeof vi.fn>;
  let originalSpawn: typeof import("node:child_process").spawn;

  beforeEach(async () => {
    const cp = await import("node:child_process");
    originalSpawn = cp.spawn;
  });

  it("constructs with default cli path", () => {
    const backend = new CursorCliBackend();
    expect(backend).toBeDefined();
  });

  it("constructs with custom cli path", () => {
    const backend = new CursorCliBackend("/usr/local/bin/cursor");
    expect(backend).toBeDefined();
  });

  it("create returns a CursorCliRun", async () => {
    const proc = createFakeProcess();
    spawnMock = vi.fn().mockReturnValue(proc);

    const { spawn: _originalSpawn } = await import("node:child_process");

    const backend = new CursorCliBackend("cursor");
    const origCreate = backend.create.bind(backend);

    backend.create = async (opts) => {
      const args = ["agent", "-p", opts.prompt, "--output-format", "stream-json"];
      spawnMock("cursor", args, { stdio: ["ignore", "pipe", "pipe"], env: expect.any(Object) });
      return new CursorCliRun(proc as any);
    };

    const run = await backend.create({
      repo: "org/repo",
      ref: "main",
      prompt: "Fix the tests",
      model: "claude-sonnet",
      metadata: { pool: "test" },
    });

    expect(run).toBeInstanceOf(CursorCliRun);
    expect(spawnMock).toHaveBeenCalledWith(
      "cursor",
      ["agent", "-p", "Fix the tests", "--output-format", "stream-json"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );

    closeProcess(proc);
    await run.wait();
  });
});
