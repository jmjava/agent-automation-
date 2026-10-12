import { describe, it, expect } from "vitest";
import { errorHash, repeatStop, filesAllowlist, runVerify } from "./gate.js";

describe("errorHash", () => {
  it("produces a 64-char hex string", () => {
    const hash = errorHash("some error output");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across ISO timestamps", () => {
    const a = errorHash("Error at 2026-10-12T19:48:00.000Z: connection refused");
    const b = errorHash("Error at 2025-01-01T00:00:00.000Z: connection refused");
    expect(a).toBe(b);
  });

  it("is stable across Unix timestamps", () => {
    const a = errorHash("failed at 1697140080000 with code 1");
    const b = errorHash("failed at 1700000000000 with code 1");
    expect(a).toBe(b);
  });

  it("is stable across PIDs", () => {
    const a = errorHash("process [12345] exited");
    const b = errorHash("process [99999] exited");
    expect(a).toBe(b);
  });

  it("is stable across pid= patterns", () => {
    const a = errorHash("pid=12345 crashed");
    const b = errorHash("pid=67890 crashed");
    expect(a).toBe(b);
  });

  it("is stable across elapsed durations", () => {
    const a = errorHash("timeout after 3000ms");
    const b = errorHash("timeout after 500ms");
    expect(a).toBe(b);
  });

  it("differs for genuinely different errors", () => {
    const a = errorHash("connection refused");
    const b = errorHash("disk full");
    expect(a).not.toBe(b);
  });
});

describe("repeatStop", () => {
  it("returns false with fewer than 2 entries", () => {
    expect(repeatStop([])).toBe(false);
    expect(repeatStop(["abc"])).toBe(false);
  });

  it("returns true when last two hashes match", () => {
    expect(repeatStop(["aaa", "bbb", "ccc", "ccc"])).toBe(true);
  });

  it("returns false when last two hashes differ", () => {
    expect(repeatStop(["aaa", "aaa", "bbb"])).toBe(false);
  });
});

describe("filesAllowlist", () => {
  it("passes when all files are in the allowlist", () => {
    const result = filesAllowlist(
      ["src/index.ts", "src/utils.ts"],
      ["src/index.ts", "src/utils.ts"],
      [],
    );
    expect(result.violations).toEqual([]);
  });

  it("reports violations for files not in allowlist or globs", () => {
    const result = filesAllowlist(
      ["src/index.ts", ".github/workflows/ci.yml"],
      ["src/index.ts"],
      [],
    );
    expect(result.violations).toEqual([".github/workflows/ci.yml"]);
  });

  it("allows files matching test globs", () => {
    const result = filesAllowlist(
      ["src/index.ts", "src/index.test.ts", "tests/unit/foo.test.ts"],
      ["src/index.ts"],
      ["**/*.test.ts"],
    );
    expect(result.violations).toEqual([]);
  });

  it("handles mixed allowlist and globs", () => {
    const result = filesAllowlist(
      ["src/main.ts", "src/main.test.ts", "docs/README.md"],
      ["src/main.ts"],
      ["**/*.test.ts"],
    );
    expect(result.violations).toEqual(["docs/README.md"]);
  });
});

describe("runVerify", () => {
  it("captures successful command output", async () => {
    const results = await runVerify(["echo hello"]);
    expect(results).toHaveLength(1);
    expect(results[0].exitCode).toBe(0);
    expect(results[0].output).toContain("hello");
  });

  it("captures failing command exit code", async () => {
    const results = await runVerify(["exit 42"]);
    expect(results).toHaveLength(1);
    expect(results[0].exitCode).not.toBe(0);
  });

  it("runs multiple commands in sequence", async () => {
    const results = await runVerify(["echo one", "echo two"]);
    expect(results).toHaveLength(2);
    expect(results[0].output).toContain("one");
    expect(results[1].output).toContain("two");
  });
});
