/**
 * TAU-bench BenchmarkAdapter — clean-room implementation matching the
 * v0.1 architecture pattern from the other shipped eval repos.
 *
 * v0.1 (this release): model-only baseline. Sends each scenario to the
 * configured `IModelAdapter` and parses out a tool-call plan. Pass/fail
 * = "did the model emit ≥1 valid-shape tool call".
 *
 * The model-only baseline is necessarily synthetic for tool-use
 * benchmarks — the real signal requires multi-turn execution against
 * tau-bench's stateful environment, which is the v0.3 follow-up.
 *
 * @module adapter
 */

import type {
  BenchmarkAdapter,
  BenchmarkRunContext,
  BenchmarkRunSummary,
  IModelAdapter,
} from 'nexus-agents';

import { loadTauBenchInstances } from './runner/instance-loader.js';
import { generatePrediction } from './runner/agent-invoker.js';
import type {
  TauBenchAdapterConfig,
  TauBenchDomain,
  TauBenchEvalResult,
  TauBenchInstance,
  TauBenchPrediction,
} from './types.js';

export class TauBenchAdapter
  implements BenchmarkAdapter<TauBenchInstance, TauBenchPrediction, TauBenchEvalResult>
{
  readonly name = 'tau-bench';

  private readonly modelAdapter: IModelAdapter;
  private readonly config: TauBenchAdapterConfig;
  private readonly resultCache = new Map<string, TauBenchEvalResult>();

  constructor(modelAdapter: IModelAdapter, config: TauBenchAdapterConfig = {}) {
    this.modelAdapter = modelAdapter;
    this.config = config;
  }

  loadInstances(_runConfig: Record<string, unknown>): Promise<readonly TauBenchInstance[]> {
    return Promise.resolve(
      loadTauBenchInstances({
        ...(this.config.source !== undefined && { source: this.config.source }),
        ...(this.config.domains !== undefined && { domains: this.config.domains }),
      })
    );
  }

  async runInstance(
    instance: TauBenchInstance,
    ctx: BenchmarkRunContext
  ): Promise<TauBenchPrediction> {
    void ctx;
    const result = await generatePrediction(instance, this.modelAdapter);

    if (!result.ok) {
      const empty: TauBenchPrediction = {
        instanceId: instance.instanceId,
        toolCalls: [],
        modelLabel: this.modelAdapter.modelId,
        durationMs: 0,
      };
      this.resultCache.set(instance.instanceId, {
        instanceId: instance.instanceId,
        domain: instance.domain,
        passed: false,
        toolCallCount: 0,
        reason: result.error.message,
      });
      return empty;
    }

    const toolCallCount = result.value.toolCalls.length;
    this.resultCache.set(instance.instanceId, {
      instanceId: instance.instanceId,
      domain: instance.domain,
      passed: toolCallCount > 0,
      toolCallCount,
      ...(toolCallCount === 0 && {
        reason: 'model returned no parsable tool calls',
      }),
    });
    return result.value;
  }

  evaluate(
    instance: TauBenchInstance,
    prediction: TauBenchPrediction
  ): Promise<TauBenchEvalResult> {
    const cached = this.resultCache.get(instance.instanceId);
    if (cached !== undefined) return Promise.resolve(cached);
    const toolCallCount = prediction.toolCalls.length;
    return Promise.resolve({
      instanceId: instance.instanceId,
      domain: instance.domain,
      passed: toolCallCount > 0,
      toolCallCount,
    });
  }

  isPass(result: TauBenchEvalResult): boolean {
    return result.passed;
  }

  /**
   * Per-domain pass-rate breakdown — TAU-bench scenarios split cleanly
   * across `airline` and `retail`, and models often score very
   * differently between the two.
   */
  summarize(
    results: readonly TauBenchEvalResult[],
    runTimeMs: number
  ): BenchmarkRunSummary {
    const passed = results.filter((r) => r.passed).length;
    const byDomain: Record<TauBenchDomain, { total: number; passed: number }> = {
      airline: { total: 0, passed: 0 },
      retail: { total: 0, passed: 0 },
    };
    for (const r of results) {
      byDomain[r.domain].total += 1;
      if (r.passed) byDomain[r.domain].passed += 1;
    }
    return {
      name: this.name,
      variant: 'model-only-baseline',
      total: results.length,
      passed,
      passRate: results.length > 0 ? passed / results.length : 0,
      runTimeMs,
      metadata: {
        byDomain: Object.fromEntries(
          Object.entries(byDomain)
            .filter(([, b]) => b.total > 0)
            .map(([k, b]) => [
              k,
              { ...b, passRate: b.total > 0 ? b.passed / b.total : 0 },
            ])
        ),
        note: 'pass/fail reflects "did the model emit ≥1 valid-shape tool call". Real grading requires multi-turn execution against tau-bench\'s stateful environment (v0.3 follow-up).',
      },
    };
  }
}
