import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initTracing,
  shutdownTracing,
  PoolTracer,
  AgentTracer,
} from "./otel.js";
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

let exporter: InMemorySpanExporter;

beforeEach(() => {
  const exp = initTracing({ inMemory: true });
  if (!exp) throw new Error("Expected in-memory exporter");
  exporter = exp;
});

afterEach(async () => {
  await shutdownTracing();
});

describe("PoolTracer", () => {
  it("creates a root span with pool.id attribute", () => {
    const pool = new PoolTracer("pool-abc");
    pool.end({ completed: 3, blocked: 1, totalTokens: 50000 });

    const spans = exporter.getFinishedSpans();
    const root = spans.find((s) => s.name === "invoke_workflow");

    expect(root).toBeDefined();
    expect(root!.attributes["pool.id"]).toBe("pool-abc");
    expect(root!.attributes["pool.summary.completed"]).toBe(3);
    expect(root!.attributes["pool.summary.blocked"]).toBe(1);
    expect(root!.attributes["pool.summary.totalTokens"]).toBe(50000);
  });

  it("startAgent creates invoke_agent child span", () => {
    const pool = new PoolTracer("pool-xyz");
    const agent = pool.startAgent("seat-1", "task-42", "claude-sonnet");
    agent.end("ok");
    pool.end({ completed: 1 });

    const spans = exporter.getFinishedSpans();
    const agentSpan = spans.find((s) => s.name === "invoke_agent");

    expect(agentSpan).toBeDefined();
    expect(agentSpan!.attributes["seat.id"]).toBe("seat-1");
    expect(agentSpan!.attributes["task.id"]).toBe("task-42");
    expect(agentSpan!.attributes["gen_ai.request.model"]).toBe("claude-sonnet");
  });
});

describe("AgentTracer", () => {
  it("records tool calls as execute_tool spans", () => {
    const pool = new PoolTracer("pool-1");
    const agent = pool.startAgent("seat-1", "task-1", "model");

    const toolId = agent.startTool("read_file", { path: "/src/main.ts" });
    agent.endTool(toolId, "export function main() {}");
    agent.end("ok");
    pool.end({});

    const spans = exporter.getFinishedSpans();
    const toolSpan = spans.find((s) => s.name === "execute_tool");

    expect(toolSpan).toBeDefined();
    expect(toolSpan!.attributes["tool.name"]).toBe("read_file");
    expect(toolSpan!.attributes["tool.arguments"]).toBe(
      JSON.stringify({ path: "/src/main.ts" }),
    );
    expect(toolSpan!.attributes["tool.result"]).toBe("export function main() {}");
  });

  it("records multiple tool calls", () => {
    const pool = new PoolTracer("pool-2");
    const agent = pool.startAgent("seat-1", "task-1", "model");

    const t1 = agent.startTool("read_file");
    agent.endTool(t1, "content-1");
    const t2 = agent.startTool("edit_file");
    agent.endTool(t2, "content-2");
    agent.end("ok");
    pool.end({});

    const spans = exporter.getFinishedSpans();
    const toolSpans = spans.filter((s) => s.name === "execute_tool");
    expect(toolSpans).toHaveLength(2);
  });

  it("records usage as span attribute", () => {
    const pool = new PoolTracer("pool-3");
    const agent = pool.startAgent("seat-1", "task-1", "model");
    agent.recordUsage(42000);
    agent.end("ok");
    pool.end({});

    const spans = exporter.getFinishedSpans();
    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan!.attributes["gen_ai.usage.total_tokens"]).toBe(42000);
  });

  it("records message events", () => {
    const pool = new PoolTracer("pool-4");
    const agent = pool.startAgent("seat-1", "task-1", "model");
    agent.recordMessage("Starting work...");
    agent.recordMessage("Done!");
    agent.end("ok");
    pool.end({});

    const spans = exporter.getFinishedSpans();
    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan!.events).toHaveLength(2);
    expect(agentSpan!.events[0].name).toBe("agent_message");
  });

  it("end with error sets ERROR status", () => {
    const pool = new PoolTracer("pool-5");
    const agent = pool.startAgent("seat-1", "task-1", "model");
    agent.end("error", "Agent crashed");
    pool.end({});

    const spans = exporter.getFinishedSpans();
    const agentSpan = spans.find((s) => s.name === "invoke_agent");
    expect(agentSpan!.status.code).toBe(2); // SpanStatusCode.ERROR = 2
    expect(agentSpan!.status.message).toBe("Agent crashed");
  });

  it("auto-closes open tool spans on end", () => {
    const pool = new PoolTracer("pool-6");
    const agent = pool.startAgent("seat-1", "task-1", "model");
    agent.startTool("slow_tool");
    agent.end("ok");
    pool.end({});

    const spans = exporter.getFinishedSpans();
    const toolSpan = spans.find((s) => s.name === "execute_tool");
    expect(toolSpan).toBeDefined();
  });

  it("endTool is a no-op for unknown toolId", () => {
    const pool = new PoolTracer("pool-7");
    const agent = pool.startAgent("seat-1", "task-1", "model");
    agent.endTool("nonexistent-id", "result");
    agent.end("ok");
    pool.end({});

    const spans = exporter.getFinishedSpans();
    const toolSpans = spans.filter((s) => s.name === "execute_tool");
    expect(toolSpans).toHaveLength(0);
  });
});

describe("multiple agents in a pool", () => {
  it("creates distinct spans per agent", () => {
    const pool = new PoolTracer("pool-multi");

    const a1 = pool.startAgent("seat-1", "task-A", "model-a");
    a1.recordUsage(1000);
    a1.end("ok");

    const a2 = pool.startAgent("seat-2", "task-B", "model-b");
    a2.recordUsage(2000);
    a2.end("ok");

    pool.end({ completed: 2, totalTokens: 3000 });

    const spans = exporter.getFinishedSpans();
    const agentSpans = spans.filter((s) => s.name === "invoke_agent");
    expect(agentSpans).toHaveLength(2);

    const seatIds = agentSpans.map((s) => s.attributes["seat.id"]);
    expect(seatIds).toContain("seat-1");
    expect(seatIds).toContain("seat-2");

    const root = spans.find((s) => s.name === "invoke_workflow");
    expect(root!.attributes["pool.summary.completed"]).toBe(2);
  });
});
