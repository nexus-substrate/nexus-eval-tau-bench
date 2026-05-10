/**
 * Public type contracts for the TAU-bench harness.
 *
 * @module types
 */

/**
 * TAU-bench publishes two scenario domains: an airline customer-service
 * environment and a retail returns environment. Each domain defines its
 * own toolset + database schema; problems are scenarios over those.
 */
export type TauBenchDomain = 'airline' | 'retail';

/**
 * One TAU-bench scenario.
 *
 * Mirrors the Sierra/tau-bench dataset row shape. Loader normalises
 * snake_case ↔ camelCase synonyms across upstream releases.
 */
export interface TauBenchInstance {
  /** Stable cross-run identifier — `<domain>__<task-id>`. */
  readonly instanceId: string;
  /** Which scenario domain. */
  readonly domain: TauBenchDomain;
  /** Natural-language user intent (the customer's request). */
  readonly userIntent: string;
  /**
   * The expected sequence of tool calls (or final state) that satisfies
   * the user intent. v0.1 only checks that the model emits *some* tool
   * call; v0.3 will exercise the full agentic loop and grade by final
   * environment state.
   */
  readonly expectedTools: ReadonlyArray<string>;
  /**
   * Optional instructions to the agent, separate from the user's
   * natural-language intent (e.g., "follow company policy X"). When
   * present, surfaced to the model in the system prompt.
   */
  readonly agentInstructions?: string;
}

/**
 * One model prediction for a TAU-bench scenario.
 *
 * v0.1 captures the structured tool calls the model emitted in a
 * single round-trip. v0.3 will capture the full multi-turn trace.
 */
export interface TauBenchPrediction {
  readonly instanceId: string;
  /**
   * Tool calls extracted from the model response. Each is a
   * `{ name, arguments }` object — names are open-ended at v0.1
   * (no schema validation against the domain's actual toolset).
   */
  readonly toolCalls: ReadonlyArray<{
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }>;
  readonly modelLabel: string;
  readonly durationMs: number;
}

/**
 * Verdict for one TAU-bench scenario.
 *
 * v0.1: passed = "did the model produce ≥1 valid-shape tool call".
 * v0.3 will replace this with grading-by-final-environment-state.
 */
export interface TauBenchEvalResult {
  readonly instanceId: string;
  readonly domain: TauBenchDomain;
  readonly passed: boolean;
  /** Number of tool calls the model emitted. */
  readonly toolCallCount: number;
  /**
   * v0.2 piece 2: count of `expectedTools` (from the dataset row) that
   * the model actually called. `expectedToolsCount` is the denominator.
   * `toolCoverage` = expectedToolsCalled / expectedToolsCount when
   * expectedToolsCount > 0, otherwise undefined.
   */
  readonly expectedToolsCalled?: number;
  /** Total expected tools for this scenario (dataset-supplied). */
  readonly expectedToolsCount?: number;
  /** Fraction of expected tools that were called. 0..1. */
  readonly toolCoverage?: number;
  /**
   * v0.2 piece 2: tool names the model emitted that are NOT in the
   * instance's `expectedTools`. Useful for spotting hallucinations
   * without a hardcoded per-domain toolset whitelist.
   */
  readonly unexpectedToolCalls?: ReadonlyArray<string>;
  readonly reason?: string;
}

export interface TauBenchAdapterConfig {
  /**
   * Where to load scenarios from.
   *
   * - `'fixture'` (default): bundled airline + retail smoke set
   * - `'github'`: fetch from `sierra-research/tau-bench` (v0.2 follow-up — not yet implemented)
   * - any other string: treat as an absolute path to a local `.jsonl`
   *   file matching the upstream schema
   */
  readonly source?: 'fixture' | 'github' | string;
  /** Filter scenarios to specific domains. */
  readonly domains?: ReadonlyArray<TauBenchDomain>;
  /** Reserved for v0.2 GitHub-fetch caching. */
  readonly cacheDir?: string;
}
