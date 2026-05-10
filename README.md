# nexus-eval-tau-bench

TAU-bench evaluation harness for [nexus-agents](https://github.com/williamzujkowski/nexus-agents) — implements the `BenchmarkAdapter` contract from nexus-agents ≥ 2.33.1.

> **Status**: v0.3 — agentic flow with stub environment. Opt in with `agenticMode: true` (or `--agentic-mode`); the model emits one tool call at a time against a stub responder built from `instance.expectedTools`. Pass/fail is still "≥1 expected tool call" — full grading via the upstream airline / retail Python environment is the v0.4 follow-up. v0.2's GitHub-fetch loader + tool-coverage diagnostics remain the default mode.

## Read this first — what v0.1 actually grades

[TAU-bench](https://github.com/sierra-research/tau-bench) is fundamentally a **multi-turn, stateful, tool-use benchmark**. The headline metric (pass-rate against grading-by-final-environment-state) requires running the model as an agent through tau-bench's domain databases and tool implementations. **This v0.1 release does NOT do that** — it asks the model for a single-turn tool-call plan and grades on whether the plan parses.

Why ship v0.1 anyway:

- Establishes the harness shape (loader / prompt / extractor / adapter) so v0.3 (the real agentic eval) is a drop-in.
- Catches regressions in tool-call output format across model upgrades — useful for routing decisions even without the full eval.
- Lets operators wire TAU-bench into nexus-agents' summary surface today, with the v0.3 promotion landing as a non-breaking adapter swap.

If you need real TAU-bench numbers right now, run upstream's [Sierra reference harness](https://github.com/sierra-research/tau-bench) directly. This repo's full grading lands at v0.3.

This repo follows the [nexus-agents harness-extraction policy](https://github.com/williamzujkowski/nexus-agents/issues/2514) — benchmarks live in standalone `nexus-eval-*` repos so they evolve independently.

## Install

```sh
npm install nexus-eval-tau-bench nexus-agents
```

`nexus-agents` is a peer dependency.

## Quick start (CLI)

```sh
# Set the OpenAI-compat endpoint
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://your-gateway/v1   # optional
export MODEL_ID=anthropic/claude-sonnet-4-6      # optional

# Smoke test against the bundled three-scenario fixture (no network)
npx nexus-eval-tau-bench --source fixture

# Filter to retail-only
npx nexus-eval-tau-bench --source fixture --domains retail

# JSON summary for piping
npx nexus-eval-tau-bench --json --source fixture > run.json
```

## Library usage

```ts
import { runBenchmark, createOpenAIAdapter } from 'nexus-agents';
import { TauBenchAdapter } from 'nexus-eval-tau-bench';

const modelAdapter = createOpenAIAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  modelId: 'gpt-4o',
});

const adapter = new TauBenchAdapter(modelAdapter, { source: 'fixture' });
const summary = await runBenchmark(adapter, {});

console.log(
  `Produced tool-call plans for ${summary.passed}/${summary.total} ` +
    `(${(summary.passRate * 100).toFixed(1)}%)`
);

const meta = summary.metadata as {
  byDomain: Record<string, { total: number; passed: number; passRate: number }>;
};
for (const [name, stats] of Object.entries(meta.byDomain)) {
  console.log(`  ${name}: ${stats.passed}/${stats.total} (${(stats.passRate * 100).toFixed(1)}%)`);
}
```

## What v0.1 actually does

- Loads scenarios from a bundled three-scenario fixture (one airline + two retail) or from a local `.jsonl` matching the upstream tau-bench row shape.
- Composes a tool-use prompt: scenario domain + user intent + (optional) agent instructions, asking for a single fenced JSON array of `{name, arguments}` tool-call objects.
- Parses the response: prefers the last fenced JSON block, falls back to whole-response JSON, drops malformed entries.
- Reports pass/fail = "did the model emit ≥1 valid-shape tool call", with a per-domain breakdown.

## What v0.1 does NOT do

- Execute the tool calls against tau-bench's stateful environment. There's no DB, no tool implementations — the prompt is single-turn.
- Grade by final-environment-state (the upstream metric).
- Verify that the called tools actually exist in the scenario's toolset (`expectedTools` is loaded but not checked at v0.1).
- Multi-turn dialogue.

## Roadmap

| Issue | Scope                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| TBD   | **v0.2 — GitHub-fetch loader**. Pull scenarios from `sierra-research/tau-bench` directly with on-disk caching.                                 |
| TBD   | **v0.2 — Toolset validation**. Cross-check emitted tool names against the scenario's domain toolset; flag hallucinations.                      |
| TBD   | **v0.3 — Agentic flow**. Plug in `ICliAdapter` + the upstream tau-bench environment for the real multi-turn grading-by-final-state metric. |

Cross-repo tracking lives at [nexus-agents #2519](https://github.com/williamzujkowski/nexus-agents/issues/2519) (Tier 2 prioritisation pass).

## The contract

`BenchmarkAdapter` from nexus-agents:

```ts
interface BenchmarkAdapter<TInstance, TPrediction, TEvalResult> {
  readonly name: string;
  readonly variant?: string;
  loadInstances(config): Promise<readonly TInstance[]>;
  runInstance(instance, ctx): Promise<TPrediction>;
  evaluate(instance, prediction): Promise<TEvalResult>;
  isPass(result): boolean;
  summarize(results, runTimeMs): BenchmarkRunSummary;
}
```

The orchestrator (`runBenchmark` in nexus-agents) handles concurrency, timeouts, progress, and partial failure — this repo doesn't reimplement the harness.

## License

MIT.
