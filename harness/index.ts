/**
 * Barrel export for the shared harness library.
 */

export { guard, type SpendConfig, type AgentRun, type SpendGuardResult } from "./spend.js";
export { createBoard, type Board, type TaskItem } from "./board.js";
export { ScriptedBoard, type BoardCall } from "./board-scripted.js";
export {
  runVerify,
  errorHash,
  repeatStop,
  filesAllowlist,
  type VerifyResult,
  type AllowlistResult,
} from "./gate.js";
export {
  writeReceipt,
  summarize,
  type PoolReceipt,
  type SeatResult,
} from "./receipt.js";
export type { AgentBackend, CreateAgentOpts } from "./backends/types.js";
export {
  ScriptedBackend,
  ScriptedRun,
  type ScriptedEvent,
  type ScriptedRunConfig,
} from "./backends/scripted.js";
export { CursorCloudBackend } from "./backends/cursor-cloud.js";
export {
  CursorCliBackend,
  CursorCliRun,
  type CliEvent,
} from "./backends/cursor-cli.js";
export {
  initTracing,
  shutdownTracing,
  PoolTracer,
  AgentTracer,
  type OtelConfig,
} from "./otel.js";
export { runPool, type PoolConfig } from "../harnesses/h1-queue-pool/run.js";
export {
  runPipeline,
  defaultStages,
  type PipelineConfig,
  type PipelineStage,
  type PipelineReceipt,
  type StageResult,
} from "../harnesses/h3-pipeline-gates/run.js";
export {
  runTournament,
  scorers,
  type TournamentConfig,
  type Scorer,
  type ContestantResult,
  type TournamentReceipt,
} from "../harnesses/h4-best-of-n/run.js";
export {
  runRouter,
  classifiers,
  type RouterConfig,
  type TierConfig,
  type Classifier,
  type RoutedResult,
  type RouterReceipt,
} from "../harnesses/h5-router-tiers/run.js";
