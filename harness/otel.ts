/**
 * OpenTelemetry tracing for agent pool runs.
 * Maps agent lifecycle events to GenAI-style spans.
 *
 * Console exporter by default; OTLP if OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */

import { trace, context, type Span, SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-base";

const TRACER_NAME = "agent-automation";
const TRACER_VERSION = "0.1.0";

export interface OtelConfig {
  /** Use in-memory exporter for testing (default: false) */
  inMemory?: boolean;
}

let _provider: BasicTracerProvider | null = null;
let _memoryExporter: InMemorySpanExporter | null = null;

/**
 * Initialize the trace provider. Call once at startup.
 * Returns the in-memory exporter when config.inMemory is set (for tests).
 */
export function initTracing(config: OtelConfig = {}): InMemorySpanExporter | null {
  if (config.inMemory) {
    _memoryExporter = new InMemorySpanExporter();
    _provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(_memoryExporter)],
    });
  } else {
    _provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
    });
  }

  trace.setGlobalTracerProvider(_provider);
  return _memoryExporter;
}

/**
 * Shut down the trace provider. Call at process exit.
 */
export async function shutdownTracing(): Promise<void> {
  if (_provider) {
    await _provider.shutdown();
    _provider = null;
    _memoryExporter = null;
    trace.disable();
  }
}

/**
 * Traces a single agent's lifecycle: tool calls, usage, completion.
 */
export class AgentTracer {
  private _span: Span;
  private _toolSpans: Map<string, Span> = new Map();

  constructor(span: Span) {
    this._span = span;
  }

  /** Record a tool invocation. Returns a tool-call id for pairing with endTool. */
  startTool(toolName: string, args?: Record<string, unknown>): string {
    const toolId = `${toolName}-${Date.now()}`;
    const tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);
    const toolSpan = tracer.startSpan(
      "execute_tool",
      {
        attributes: {
          "tool.name": toolName,
          ...(args ? { "tool.arguments": JSON.stringify(args) } : {}),
        },
      },
      context.active(),
    );
    this._toolSpans.set(toolId, toolSpan);
    return toolId;
  }

  /** End a previously started tool span. */
  endTool(toolId: string, result?: string): void {
    const span = this._toolSpans.get(toolId);
    if (span) {
      if (result !== undefined) {
        span.setAttribute("tool.result", result.slice(0, 4096));
      }
      span.end();
      this._toolSpans.delete(toolId);
    }
  }

  /** Record cumulative token usage on the agent span. */
  recordUsage(totalTokens: number): void {
    this._span.setAttribute("gen_ai.usage.total_tokens", totalTokens);
  }

  /** Record a message event on the agent span. */
  recordMessage(content: string): void {
    this._span.addEvent("agent_message", {
      "message.content": content.slice(0, 4096),
    });
  }

  /** Mark the agent as complete and end its span. */
  end(status: "ok" | "error" = "ok", errorMessage?: string): void {
    for (const [id] of this._toolSpans) {
      this.endTool(id);
    }

    if (status === "error") {
      this._span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });
    } else {
      this._span.setStatus({ code: SpanStatusCode.OK });
    }
    this._span.end();
  }
}

/**
 * Traces an entire pool invocation workflow.
 */
export class PoolTracer {
  private _rootSpan: Span;

  constructor(poolId: string) {
    const tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);
    this._rootSpan = tracer.startSpan("invoke_workflow", {
      attributes: { "pool.id": poolId },
    });
  }

  /** Create a child span for a single agent seat. */
  startAgent(seatId: string, taskId: string, model: string): AgentTracer {
    const tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);
    const agentSpan = tracer.startSpan(
      "invoke_agent",
      {
        attributes: {
          "seat.id": seatId,
          "task.id": taskId,
          "gen_ai.request.model": model,
        },
      },
      context.active(),
    );
    return new AgentTracer(agentSpan);
  }

  /** End the pool root span with summary attributes. */
  end(summary: Record<string, number>): void {
    const attrs: Record<string, number> = {};
    for (const [k, v] of Object.entries(summary)) {
      attrs[`pool.summary.${k}`] = v;
    }
    this._rootSpan.setAttributes(attrs);
    this._rootSpan.setStatus({ code: SpanStatusCode.OK });
    this._rootSpan.end();
  }
}
