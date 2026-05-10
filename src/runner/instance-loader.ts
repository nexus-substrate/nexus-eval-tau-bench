/**
 * TAU-bench scenario loader.
 *
 * v0.1 scope:
 *   - Bundled fixture (3 scenarios across the two domains) for smoke
 *     testing without network or upstream checkout.
 *   - Local `.jsonl` source — read scenarios that match the upstream
 *     row shape from disk.
 *
 * v0.2 follow-up: GitHub-fetch source against `sierra-research/tau-bench`
 * with on-disk caching. Same pattern as nexus-eval-aider-polyglot's
 * github-loader.
 *
 * @module runner/instance-loader
 */

import { existsSync, readFileSync } from 'node:fs';

import type { TauBenchInstance } from '../types.js';
import { loadFromGithub, type LoadFromGithubOptions } from './github-loader.js';

const FIXTURE: readonly TauBenchInstance[] = [
  {
    instanceId: 'airline__cancel-flight-no-refund',
    domain: 'airline',
    userIntent:
      "I'd like to cancel my flight ABC123. The booking is non-refundable. Tell me what credit you can offer.",
    expectedTools: ['lookup_booking', 'check_cancellation_policy', 'issue_credit'],
    agentInstructions:
      'You are a customer-service agent. Always look up the booking before quoting policy.',
  },
  {
    instanceId: 'retail__return-with-receipt',
    domain: 'retail',
    userIntent:
      'I bought item SKU-42 last week and it arrived damaged. I have my order number ORD-9001 and want a full refund.',
    expectedTools: ['lookup_order', 'verify_damage_claim', 'process_refund'],
  },
  {
    instanceId: 'retail__exchange-different-size',
    domain: 'retail',
    userIntent:
      "I'd like to exchange my recent purchase (order ORD-7755) for a larger size of the same product.",
    expectedTools: ['lookup_order', 'check_inventory', 'process_exchange'],
    agentInstructions:
      'Confirm the requested size is in stock before promising the exchange.',
  },
];

export async function loadTauBenchInstances(args: {
  readonly source?: 'fixture' | 'github' | string;
  readonly domains?: ReadonlyArray<TauBenchInstance['domain']>;
  readonly maxInstances?: number;
  readonly githubOptions?: LoadFromGithubOptions;
}): Promise<readonly TauBenchInstance[]> {
  const source = args.source ?? 'fixture';

  let all: readonly TauBenchInstance[];
  if (source === 'fixture') {
    all = FIXTURE;
  } else if (source === 'github' || source.startsWith('github:')) {
    const ref = source.startsWith('github:') ? source.slice('github:'.length) : undefined;
    all = await loadFromGithub({
      ...(args.githubOptions ?? {}),
      ...(ref !== undefined && ref !== '' && { ref }),
      ...(args.domains !== undefined && { domains: args.domains }),
    });
  } else {
    all = loadFromJsonl(source);
  }

  let filtered = all;
  if (args.domains !== undefined && args.domains.length > 0) {
    const allowed = new Set(args.domains);
    filtered = filtered.filter((i) => allowed.has(i.domain));
  }
  if (args.maxInstances !== undefined && args.maxInstances < filtered.length) {
    filtered = filtered.slice(0, args.maxInstances);
  }
  return filtered;
}

const VALID_DOMAINS = new Set(['airline', 'retail']);

function loadFromJsonl(path: string): readonly TauBenchInstance[] {
  if (!existsSync(path)) {
    throw new Error(`TAU-bench .jsonl path not found: ${path}`);
  }
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line, idx) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (e: unknown) {
      throw new Error(
        `Failed to parse .jsonl row ${String(idx)} in ${path}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    return normaliseRow(raw, idx);
  });
}

function normaliseRow(raw: unknown, idx: number): TauBenchInstance {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`.jsonl row ${String(idx)} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  const instanceId = pickString(r, ['instanceId', 'instance_id', 'task_id', 'id']);
  const domain = pickString(r, ['domain', 'env']);
  if (!VALID_DOMAINS.has(domain)) {
    throw new Error(
      `.jsonl row ${String(idx)} has invalid domain '${domain}' — must be one of: ${[...VALID_DOMAINS].join(', ')}`
    );
  }
  const userIntent = pickString(r, ['userIntent', 'user_intent', 'instruction', 'user_request']);
  const expectedToolsRaw = r['expectedTools'] ?? r['expected_tools'] ?? r['tools'];
  const expectedTools = Array.isArray(expectedToolsRaw)
    ? expectedToolsRaw.filter((t): t is string => typeof t === 'string')
    : [];
  const agentInstructions = optString(r, ['agentInstructions', 'agent_instructions', 'system']);

  return {
    instanceId,
    domain: domain as TauBenchInstance['domain'],
    userIntent,
    expectedTools,
    ...(agentInstructions !== undefined && { agentInstructions }),
  };
}

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  throw new Error(`Missing required field — tried: ${keys.join(', ')}`);
}

function optString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
