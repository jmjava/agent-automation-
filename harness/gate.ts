/**
 * Verification gates — shell verify runner, error hashing, repeat detection,
 * and file allowlist enforcement.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VerifyResult {
  command: string;
  exitCode: number;
  output: string;
}

/**
 * Execute shell commands sequentially and capture results.
 */
export async function runVerify(commands: string[]): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];

  for (const command of commands) {
    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      results.push({ command, exitCode: 0, output: stdout + stderr });
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      results.push({
        command,
        exitCode: typeof e.code === "number" ? e.code : 1,
        output: (e.stdout ?? "") + (e.stderr ?? ""),
      });
    }
  }

  return results;
}

/**
 * Produce a stable SHA-256 hash of command output, stripping
 * timestamps, PIDs, and other volatile text.
 */
export function errorHash(output: string): string {
  const stripped = output
    // ISO 8601 timestamps: 2026-10-12T19:48:00.000Z or 2026-10-12 19:48:00
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "<TS>")
    // Unix timestamps (10+ digits)
    .replace(/\b\d{10,13}\b/g, "<EPOCH>")
    // PID-like patterns: [12345] or pid=12345
    .replace(/\[(\d{2,7})\]/g, "[<PID>]")
    .replace(/\bpid[=:]\s*\d+/gi, "pid=<PID>")
    // Elapsed/duration: 123ms, 1.5s, etc.
    .replace(/\b\d+(\.\d+)?\s*(ms|s|sec|seconds|minutes|min)\b/gi, "<DUR>");

  return createHash("sha256").update(stripped).digest("hex");
}

/**
 * Return true when the last two hashes in the history are identical,
 * indicating the same error is repeating.
 */
export function repeatStop(history: string[]): boolean {
  if (history.length < 2) return false;
  return history[history.length - 1] === history[history.length - 2];
}

export interface AllowlistResult {
  violations: string[];
}

/**
 * Check that every path in diffPaths either appears in allowedFiles
 * exactly or matches one of the testGlobs.
 */
export function filesAllowlist(
  diffPaths: string[],
  allowedFiles: string[],
  testGlobs: string[],
): AllowlistResult {
  // Dynamically import picomatch (ESM-compatible)
  const allowedSet = new Set(allowedFiles);
  const violations: string[] = [];

  for (const p of diffPaths) {
    if (allowedSet.has(p)) continue;

    const matchesGlob = testGlobs.some((glob) => {
      return matchGlob(p, glob);
    });

    if (!matchesGlob) {
      violations.push(p);
    }
  }

  return { violations };
}

/**
 * Minimal glob matcher supporting * and ** patterns.
 * For production, use picomatch — this is a zero-dep fallback.
 */
function matchGlob(path: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<GLOBSTAR>>/g, ".*");
  return new RegExp(`^${regexStr}$`).test(path);
}
