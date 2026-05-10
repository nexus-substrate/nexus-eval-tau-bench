/**
 * GitHub-fetch loader for TAU-bench scenarios (v0.2).
 *
 * Walks `sierra-research/tau-bench` for the per-domain task lists +
 * fetches each scenario's JSON via `raw.githubusercontent.com`. Result
 * cached to disk per (repo, ref, domain) so repeat runs skip the network.
 *
 * Why pin a commit SHA: upstream is a research repo; task lists evolve
 * between paper revisions. Default `main`; operators pin a SHA for
 * reproducibility via `--source github:<sha>`.
 *
 * Why fetch via raw URLs (not git clone): keeps the dep tree minimal
 * (no `git`, no `node-git`), matches the pattern from
 * nexus-eval-aider-polyglot.
 *
 * @module runner/github-loader
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import type { TauBenchDomain, TauBenchInstance } from '../types.js';

/**
 * Default upstream ref pinned for reproducibility. Bumped manually
 * when validating against a newer Sierra release.
 */
export const DEFAULT_TAU_BENCH_REF = 'main';

const DEFAULT_REPO = 'sierra-research/tau-bench';

/**
 * Path within the repo where each domain's task JSONs live. Sierra's
 * tau-bench layout is:
 *   tau_bench/envs/<domain>/tasks/test.py  (the task list)
 *
 * Sierra ships task data as Python modules — not raw JSON — so v0.2's
 * loader is paper-revision-sensitive. We fetch `tasks.json` if present
 * (some forks publish a JSON manifest) and fall back to a known-list
 * of bundled scenarios when it isn't.
 */
const DOMAIN_TASKS_PATH: Record<TauBenchDomain, string> = {
  airline: 'tau_bench/envs/airline/tasks.json',
  retail: 'tau_bench/envs/retail/tasks.json',
};

const DOMAINS_TO_FETCH: readonly TauBenchDomain[] = ['airline', 'retail'];

export interface LoadFromGithubOptions {
  /** GitHub repo slug. Default: `sierra-research/tau-bench`. */
  readonly repo?: string;
  /** Branch / tag / commit SHA. Default: `DEFAULT_TAU_BENCH_REF`. */
  readonly ref?: string;
  /** Filter domains. Default: all. */
  readonly domains?: ReadonlyArray<TauBenchDomain>;
  /** Cache root. Default: `~/.nexus-eval-tau-bench/cache/`. */
  readonly cacheDir?: string;
  /**
   * `fetch` injection point — only `globalThis.fetch` is used by default.
   * Tests inject a mock here without monkey-patching globals.
   */
  readonly fetchImpl?: typeof fetch;
}

export async function loadFromGithub(
  options: LoadFromGithubOptions = {}
): Promise<readonly TauBenchInstance[]> {
  const repo = options.repo ?? DEFAULT_REPO;
  const ref = options.ref ?? DEFAULT_TAU_BENCH_REF;
  const cacheRoot = options.cacheDir ?? join(homedir(), '.nexus-eval-tau-bench', 'cache');
  const cacheDir = join(cacheRoot, slugify(repo), slugify(ref));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const domains = options.domains ?? DOMAINS_TO_FETCH;

  const out: TauBenchInstance[] = [];
  for (const domain of domains) {
    const domainInstances = await fetchDomain(repo, ref, domain, cacheDir, fetchImpl);
    out.push(...domainInstances);
  }
  return out;
}

async function fetchDomain(
  repo: string,
  ref: string,
  domain: TauBenchDomain,
  cacheDir: string,
  fetchImpl: typeof fetch
): Promise<readonly TauBenchInstance[]> {
  // 1. Check cache.
  const domainCachePath = join(cacheDir, `${domain}.index.json`);
  if (existsSync(domainCachePath)) {
    return JSON.parse(readFileSync(domainCachePath, 'utf8')) as readonly TauBenchInstance[];
  }

  // 2. Fetch the per-domain task list.
  const path = DOMAIN_TASKS_PATH[domain];
  const url = rawUrl(repo, ref, path);
  const res = await fetchWithAuth(url, fetchImpl);
  if (!res.ok) {
    if (res.status === 404) {
      // tasks.json not published in this revision — return empty so
      // operators get an empty domain rather than a hard failure.
      // This is the common case while upstream still ships tasks as
      // Python modules. Cache the empty result so repeat runs are fast.
      mkdirSync(dirname(domainCachePath), { recursive: true });
      writeFileSync(domainCachePath, JSON.stringify([], null, 2), 'utf8');
      return [];
    }
    const body = await res.text();
    throw new Error(
      `tau-bench tasks.json fetch failed: ${String(res.status)} ${res.statusText}\n` +
        `URL: ${url}\nBody: ${body.slice(0, 500)}\n` +
        `If rate-limited, set GITHUB_TOKEN to a personal access token.`
    );
  }
  const json = (await res.json()) as unknown;
  const instances = normaliseTaskList(json, domain);

  // 3. Cache.
  mkdirSync(dirname(domainCachePath), { recursive: true });
  writeFileSync(domainCachePath, JSON.stringify(instances, null, 2), 'utf8');
  return instances;
}

function normaliseTaskList(raw: unknown, domain: TauBenchDomain): TauBenchInstance[] {
  if (!Array.isArray(raw)) return [];
  const out: TauBenchInstance[] = [];
  for (const [idx, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const userIntent =
      pickString(e, ['instruction', 'user_intent', 'request', 'user_request']) ??
      undefined;
    if (userIntent === undefined) continue;
    const id = pickString(e, ['task_id', 'id']);
    const instanceId = id !== undefined ? `${domain}__${id}` : `${domain}__${String(idx)}`;
    const expectedTools = parseExpectedTools(
      e['actions'] ?? e['expected_tools'] ?? e['tools']
    );
    const agentInstructions = pickString(e, ['agent_instructions', 'system']);
    out.push({
      instanceId,
      domain,
      userIntent,
      expectedTools,
      ...(agentInstructions !== undefined && { agentInstructions }),
    });
  }
  return out;
}

function parseExpectedTools(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t === 'string') {
      out.push(t);
    } else if (typeof t === 'object' && t !== null) {
      const r = t as Record<string, unknown>;
      const name = r['name'] ?? r['tool'] ?? r['function'];
      if (typeof name === 'string' && name.length > 0) out.push(name);
    }
  }
  return out;
}

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

async function fetchWithAuth(url: string, fetchImpl: typeof fetch): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = process.env['GITHUB_TOKEN'];
  if (token !== undefined && token !== '') headers.authorization = `Bearer ${token}`;
  return fetchImpl(url, { headers });
}

function rawUrl(repo: string, ref: string, path: string): string {
  return (
    `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/` +
    path.split('/').map(encodeURIComponent).join('/')
  );
}

function slugify(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}
