/**
 * Tests for the TAU-bench GitHub-fetch loader.
 *
 * Mocks `fetch` via the fetchImpl injection — no network in CI.
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { loadFromGithub } from './github-loader.js';

interface FakeTask {
  task_id?: string;
  instruction: string;
  actions?: ReadonlyArray<string | { name: string }>;
  agent_instructions?: string;
}

function makeTaskList(tasks: readonly FakeTask[]): Response {
  return new Response(JSON.stringify(tasks), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFetchMock(plan: Record<string, Response | (() => Response)>): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    for (const [pattern, response] of Object.entries(plan)) {
      if (u.includes(pattern)) {
        return typeof response === 'function' ? response() : response;
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('loadFromGithub (tau-bench)', () => {
  let cacheDir: string;
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'tau-bench-test-'));
    delete process.env['GITHUB_TOKEN'];
  });
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('fetches per-domain task lists and normalises to instances', async () => {
    const fetchImpl = makeFetchMock({
      'airline/tasks.json': makeTaskList([
        {
          task_id: 'a-001',
          instruction: 'Cancel flight ABC123.',
          actions: ['lookup_booking', 'cancel_booking'],
        },
      ]),
      'retail/tasks.json': makeTaskList([
        {
          task_id: 'r-001',
          instruction: 'Return SKU-42.',
          actions: ['lookup_order', 'process_refund'],
        },
      ]),
    });
    const instances = await loadFromGithub({ cacheDir, fetchImpl });
    expect(instances).toHaveLength(2);
    expect(instances.find((i) => i.domain === 'airline')?.instanceId).toBe('airline__a-001');
    expect(instances.find((i) => i.domain === 'retail')?.instanceId).toBe('retail__r-001');
  });

  it('honours the domains filter (only requested domains fetched)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      calls.push(u);
      if (u.includes('airline/tasks.json')) {
        return makeTaskList([{ task_id: '1', instruction: 'q', actions: ['lookup_booking'] }]);
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    await loadFromGithub({ cacheDir, fetchImpl, domains: ['airline'] });
    // Only airline endpoint should have been hit.
    expect(calls.some((c) => c.includes('airline/tasks.json'))).toBe(true);
    expect(calls.some((c) => c.includes('retail/tasks.json'))).toBe(false);
  });

  it('treats 404 (tasks.json not yet published) as an empty domain', async () => {
    const fetchImpl = makeFetchMock({
      'airline/tasks.json': new Response('not found', { status: 404 }),
      'retail/tasks.json': makeTaskList([
        { task_id: 'r-001', instruction: 'q', actions: ['lookup_order'] },
      ]),
    });
    const instances = await loadFromGithub({ cacheDir, fetchImpl });
    // Airline empty, retail has 1.
    expect(instances).toHaveLength(1);
    expect(instances[0]?.domain).toBe('retail');
  });

  it('parses actions as either string-array or {name}-objects', async () => {
    const fetchImpl = makeFetchMock({
      'airline/tasks.json': makeTaskList([
        {
          task_id: '1',
          instruction: 'q',
          actions: [{ name: 'lookup_booking' }, 'cancel_booking'],
        },
      ]),
      'retail/tasks.json': makeTaskList([]),
    });
    const instances = await loadFromGithub({ cacheDir, fetchImpl, domains: ['airline'] });
    expect(instances[0]?.expectedTools).toEqual(['lookup_booking', 'cancel_booking']);
  });

  it('caches the per-domain JSON; second call serves from cache', async () => {
    const fetchImpl = vi.fn(async () =>
      makeTaskList([{ task_id: '1', instruction: 'q', actions: ['x'] }])
    ) as unknown as typeof fetch;
    await loadFromGithub({ cacheDir, fetchImpl, domains: ['airline'] });
    const firstCalls = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    await loadFromGithub({ cacheDir, fetchImpl, domains: ['airline'] });
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(firstCalls);
  });

  it('attaches GITHUB_TOKEN auth header when env is set', async () => {
    process.env['GITHUB_TOKEN'] = 'sekret';
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['authorization']).toBe('Bearer sekret');
      return makeTaskList([]);
    }) as unknown as typeof fetch;
    await loadFromGithub({ cacheDir, fetchImpl, domains: ['airline'] });
  });

  it('surfaces a clear error on non-2xx (other than 404)', async () => {
    const fetchImpl = makeFetchMock({
      'airline/tasks.json': new Response('rate limit', {
        status: 429,
        statusText: 'Too Many Requests',
      }),
    });
    await expect(
      loadFromGithub({ cacheDir, fetchImpl, domains: ['airline'] })
    ).rejects.toThrow(/tau-bench tasks\.json fetch failed: 429.*GITHUB_TOKEN/s);
  });

  it('drops tasks missing instruction', async () => {
    const fetchImpl = makeFetchMock({
      'airline/tasks.json': makeTaskList([
        { task_id: '1', instruction: 'good', actions: [] },
        { task_id: '2', actions: [] } as unknown as FakeTask, // no instruction
      ]),
      'retail/tasks.json': makeTaskList([]),
    });
    const instances = await loadFromGithub({ cacheDir, fetchImpl, domains: ['airline'] });
    expect(instances).toHaveLength(1);
    expect(instances[0]?.userIntent).toBe('good');
  });

  it('writes cache file in JSON form for the next run', async () => {
    const fetchImpl = makeFetchMock({
      'airline/tasks.json': makeTaskList([{ task_id: '1', instruction: 'q', actions: [] }]),
      'retail/tasks.json': makeTaskList([]),
    });
    await loadFromGithub({ cacheDir, fetchImpl, domains: ['airline'], ref: 'abc' });
    const cachePath = join(cacheDir, 'sierra-research_tau-bench', 'abc', 'airline.index.json');
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as Array<{
      instanceId: string;
    }>;
    expect(cached[0]?.instanceId).toBe('airline__1');
  });
});
