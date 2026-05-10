#!/usr/bin/env node
/**
 * TAU-bench evaluation CLI.
 *
 * @module cli
 */

import { parseArgs } from 'node:util';
import { runBenchmark, createOpenAIAdapter } from 'nexus-agents';
import { TauBenchAdapter } from './adapter.js';
import type { TauBenchDomain } from './types.js';

const VALID_DOMAINS: ReadonlyArray<TauBenchDomain> = ['airline', 'retail'];

const HELP = `nexus-eval-tau-bench — TAU-bench evaluation harness

Usage:
  nexus-eval-tau-bench [run] [options]
  nexus-eval-tau-bench --version
  nexus-eval-tau-bench --help

Options:
  --model-id <id>             Model identifier passed to the OpenAI-compat
                              endpoint. Default: env MODEL_ID or 'gpt-4o'.
  --source <fixture|github|github:<ref>|path>
                              Where to load scenarios from. Default: fixture.
                              'fixture' loads the bundled three-scenario smoke
                              set; 'github' fetches from sierra-research/tau-bench
                              main branch with on-disk cache (set GITHUB_TOKEN
                              if rate-limited); 'github:<ref>' pins a branch /
                              tag / commit SHA; <path> points at a local .jsonl.
  --domains <comma-list>      Filter by domain (airline,retail).
  --limit <n>                 Limit scenarios. Default: all.
  --concurrency <n>           Max parallel solver calls. Default: 1.
  --timeout <ms>              Per-instance timeout. Default: 300000.
  --json                      JSON summary instead of human text.
  --help, -h                  Show this help.
  --version, -v               Show version.

Environment:
  OPENAI_API_KEY      (required) auth for the OpenAI-compat endpoint.
  OPENAI_BASE_URL     (optional) override base URL.
  MODEL_ID            (optional) default model — overridden by --model-id.

Notes:
  v0.1 is a model-only baseline — sends each scenario's user intent +
  agent instructions to the model and parses out a single-turn tool-call
  plan. Pass/fail reflects "did the model emit ≥1 valid-shape tool call",
  NOT real multi-turn grading. v0.3 will plug in ICliAdapter for the full
  agentic loop against tau-bench's stateful environment.
`;

function parseDomains(input: string | undefined): TauBenchDomain[] | undefined {
  if (input === undefined || input === '') return undefined;
  const parts = input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  for (const p of parts) {
    if (!(VALID_DOMAINS as readonly string[]).includes(p)) {
      throw new Error(`Invalid --domains value '${p}'. Must be one of: ${VALID_DOMAINS.join(', ')}`);
    }
  }
  return parts as TauBenchDomain[];
}

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write('nexus-eval-tau-bench 0.2.0\n');
    return 0;
  }

  const parsed = parseArgs({
    args: args[0] === 'run' ? args.slice(1) : args,
    options: {
      'model-id': { type: 'string' },
      source: { type: 'string' },
      domains: { type: 'string' },
      limit: { type: 'string' },
      concurrency: { type: 'string', default: '1' },
      timeout: { type: 'string', default: '300000' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const apiKey = process.env['OPENAI_API_KEY']?.trim();
  if (apiKey === undefined || apiKey === '') {
    process.stderr.write(
      'Error: OPENAI_API_KEY is not set. Set it to the auth token for your\n' +
        'OpenAI-compat endpoint (real OpenAI, a workspace proxy, vLLM, etc.).\n'
    );
    return 2;
  }

  const modelId =
    parsed.values['model-id'] ?? process.env['MODEL_ID'] ?? 'gpt-4o';
  const baseUrl = process.env['OPENAI_BASE_URL'];
  const limit =
    parsed.values.limit !== undefined ? Number(parsed.values.limit) : undefined;
  const concurrency = Number(parsed.values.concurrency ?? '1');
  const timeoutMs = Number(parsed.values.timeout ?? '300000');
  const domains = parseDomains(parsed.values.domains);

  const modelAdapter = createOpenAIAdapter({
    apiKey,
    modelId,
    ...(baseUrl !== undefined && baseUrl !== '' && { baseUrl }),
  });

  const adapter = new TauBenchAdapter(modelAdapter, {
    ...(parsed.values.source !== undefined && { source: parsed.values.source }),
    ...(domains !== undefined && { domains }),
  });

  const summary = await runBenchmark(adapter, {}, {
    concurrency,
    instanceTimeoutMs: timeoutMs,
    ...(limit !== undefined ? { limit } : {}),
    onProgress: (done: number, total: number): void => {
      if (!parsed.values.json) {
        process.stderr.write(`[${String(done)}/${String(total)}]\r`);
      }
    },
  });

  if (parsed.values.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write('\n');
    process.stdout.write(`${adapter.name} (model=${modelId})\n`);
    process.stdout.write(
      `  produced:   ${String(summary.passed)} / ${String(summary.total)} non-empty tool-call plans\n`
    );
    process.stdout.write(`  rate:       ${(summary.passRate * 100).toFixed(1)}%\n`);
    process.stdout.write(`  runtime:    ${(summary.runTimeMs / 1000).toFixed(1)}s\n`);
    const meta = summary.metadata as {
      byDomain?: Record<string, { total: number; passed: number; passRate: number }>;
    };
    if (meta.byDomain !== undefined) {
      process.stdout.write('  by domain:\n');
      for (const [name, stats] of Object.entries(meta.byDomain)) {
        process.stdout.write(
          `    ${name.padEnd(8)}  ${String(stats.passed)}/${String(stats.total)} ` +
            `(${(stats.passRate * 100).toFixed(1)}%)\n`
        );
      }
    }
  }

  return summary.passed === summary.total ? 0 : 1;
}

main(process.argv)
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal: ${msg}\n`);
    process.exit(2);
  });
