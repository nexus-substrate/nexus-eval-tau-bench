/**
 * Library entry point — public exports of the TAU-bench harness.
 *
 * @module index
 */

export { TauBenchAdapter } from './adapter.js';
export type {
  TauBenchAdapterConfig,
  TauBenchDomain,
  TauBenchEvalResult,
  TauBenchInstance,
  TauBenchPrediction,
} from './types.js';

// Lower-level building blocks.
export { loadTauBenchInstances } from './runner/instance-loader.js';
export { generatePrediction } from './runner/agent-invoker.js';
export type { GeneratePredictionOptions } from './runner/agent-invoker.js';
export { extractToolCalls } from './runner/tool-call-extractor.js';
export type { ToolCall } from './runner/tool-call-extractor.js';
export { composeUserPrompt, getSystemPrompt } from './runner/prompt-template.js';
