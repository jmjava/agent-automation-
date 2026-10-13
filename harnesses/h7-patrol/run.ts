/**
 * H7 patrol watchdog harness.
 *
 * Monitors running agents and nudges stalled ones.
 *
 * Flow:
 * 1. Other harnesses (H1, H3, etc.) register agents with patrol.watch(agentId)
 * 2. Agents send patrol.heartbeat(agentId) when they produce events
 * 3. Patrol polls on interval, checking now - lastEventAt > stallThreshold
 * 4. If stalled: call onStall(agentId, duration, nudgeCount)
 * 5. Handler returns: "nudge" (send a follow-up message), "cancel" (kill it), "ignore"
 * 6. After maxNudges, auto-cancel
 * 7. patrol.stop() returns the report
 */

/* ─── Public types ─── */

export interface PatrolConfig {
  patrolId: string;
  /** How often to check (default 30000) */
  pollIntervalMs: number;
  /** No new events for this long = stalled (default 300000 = 5min) */
  stallThresholdMs: number;
  /** Max nudges before giving up (default 2) */
  maxNudges: number;
  onStall: StallHandler;
}

export interface StallHandler {
  (agentId: string, stallDurationMs: number, nudgeCount: number): Promise<StallAction>;
}

export type StallAction = "nudge" | "cancel" | "ignore";

export interface PatrolledAgent {
  agentId: string;
  /** Timestamp of last activity */
  lastEventAt: number;
  nudgeCount: number;
  status: "active" | "stalled" | "cancelled" | "completed";
}

export interface PatrolReport {
  patrolId: string;
  agents: PatrolledAgent[];
  totalNudges: number;
  totalCancelled: number;
  durationMs: number;
}

/* ─── Patrol class ─── */

export class Patrol {
  private agents: Map<string, PatrolledAgent> = new Map();
  private running = false;
  private startedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private config: PatrolConfig) {}

  /** Register an agent to watch */
  watch(agentId: string): void {
    this.agents.set(agentId, {
      agentId,
      lastEventAt: Date.now(),
      nudgeCount: 0,
      status: "active",
    });
  }

  /** Record activity from an agent */
  heartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent && agent.status === "active") {
      agent.lastEventAt = Date.now();
      agent.nudgeCount = 0;
    }
  }

  /** Mark agent as completed (stop watching) */
  complete(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = "completed";
    }
  }

  /** Start the patrol loop */
  async start(): Promise<void> {
    this.running = true;
    this.startedAt = Date.now();

    this.timer = setInterval(async () => {
      if (!this.running) return;
      await this.tick();
    }, this.config.pollIntervalMs);
  }

  /** Stop the patrol loop */
  stop(): PatrolReport {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.buildReport();
  }

  /** Check all agents once (for testing) */
  async tick(): Promise<PatrolledAgent[]> {
    const now = Date.now();
    const stalled: PatrolledAgent[] = [];

    for (const agent of this.agents.values()) {
      if (agent.status !== "active") continue;

      const stallDuration = now - agent.lastEventAt;
      if (stallDuration <= this.config.stallThresholdMs) continue;

      if (agent.nudgeCount >= this.config.maxNudges) {
        agent.status = "cancelled";
        stalled.push({ ...agent });
        continue;
      }

      const action = await this.config.onStall(
        agent.agentId,
        stallDuration,
        agent.nudgeCount,
      );

      switch (action) {
        case "nudge":
          agent.nudgeCount++;
          stalled.push({ ...agent, status: "stalled" });
          break;
        case "cancel":
          agent.status = "cancelled";
          stalled.push({ ...agent });
          break;
        case "ignore":
          stalled.push({ ...agent });
          break;
      }
    }

    return stalled;
  }

  /* ─── Private ─── */

  private buildReport(): PatrolReport {
    const agents = Array.from(this.agents.values()).map((a) => ({ ...a }));
    const totalNudges = agents.reduce((sum, a) => sum + a.nudgeCount, 0);
    const totalCancelled = agents.filter((a) => a.status === "cancelled").length;
    const durationMs = this.startedAt > 0 ? Date.now() - this.startedAt : 0;

    return {
      patrolId: this.config.patrolId,
      agents,
      totalNudges,
      totalCancelled,
      durationMs,
    };
  }
}
