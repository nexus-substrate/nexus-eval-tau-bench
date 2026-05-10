/**
 * Smoke tests for TauBenchAdapter (v0.1).
 */
import { describe, it, expect, vi } from 'vitest';
import { ok, runBenchmark, type IModelAdapter } from 'nexus-agents';
import { TauBenchAdapter } from './adapter.js';
import { extractToolCalls } from './runner/tool-call-extractor.js';
import { composeUserPrompt, getSystemPrompt } from './runner/prompt-template.js';
import type { TauBenchInstance } from './types.js';

const fixtureInstance: TauBenchInstance = {
  instanceId: 'airline__sample',
  domain: 'airline',
  userIntent: 'Cancel my flight ABC123.',
  expectedTools: ['lookup_booking', 'cancel_booking'],
};

function makeMockModelAdapter(response: string): IModelAdapter {
  const completion = vi.fn(() => Promise.resolve(ok({ content: response })));
  return {
    providerId: 'mock',
    modelId: 'mock-tau-bench-model',
    capabilities: [],
    complete: completion as never,
    stream: (() => (async function* () {})()) as never,
    countTokens: () => Promise.resolve(0),
    validateConfig: () => ({ ok: true as const, value: undefined }),
  };
}

describe('TauBenchAdapter', () => {
  it('parses a fenced JSON tool-call array from the response', async () => {
    const response =
      '```json\n[{"name": "lookup_booking", "arguments": {"id": "ABC123"}}]\n```';
    const adapter = new TauBenchAdapter(makeMockModelAdapter(response));
    const prediction = await adapter.runInstance(fixtureInstance, {} as never);
    expect(prediction.toolCalls).toHaveLength(1);
    expect(prediction.toolCalls[0]?.name).toBe('lookup_booking');
    expect(prediction.toolCalls[0]?.arguments['id']).toBe('ABC123');
  });

  it('records empty-toolcall responses without throwing', async () => {
    const adapter = new TauBenchAdapter(makeMockModelAdapter('I cannot help with that.'));
    const prediction = await adapter.runInstance(fixtureInstance, {} as never);
    expect(prediction.toolCalls).toHaveLength(0);
    const verdict = await adapter.evaluate(fixtureInstance, prediction);
    expect(verdict.passed).toBe(false);
    expect(adapter.isPass(verdict)).toBe(false);
  });

  it('isPass true when ≥1 valid tool call', async () => {
    const response = '```json\n[{"name": "x", "arguments": {}}]\n```';
    const adapter = new TauBenchAdapter(makeMockModelAdapter(response));
    const prediction = await adapter.runInstance(fixtureInstance, {} as never);
    expect(adapter.isPass(await adapter.evaluate(fixtureInstance, prediction))).toBe(true);
  });

  it('end-to-end against bundled fixture (3 scenarios)', async () => {
    const response = '```json\n[{"name": "lookup_booking", "arguments": {}}]\n```';
    const adapter = new TauBenchAdapter(makeMockModelAdapter(response), { source: 'fixture' });
    const summary = await runBenchmark(adapter, {});
    expect(summary.name).toBe('tau-bench');
    expect(summary.variant).toBe('model-only-baseline');
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(3);
  });

  it('domain filter narrows the fixture set', async () => {
    const adapter = new TauBenchAdapter(makeMockModelAdapter(''), {
      source: 'fixture',
      domains: ['retail'],
    });
    const instances = await adapter.loadInstances({});
    expect(instances.every((i) => i.domain === 'retail')).toBe(true);
    expect(instances.length).toBeGreaterThan(0);
  });

  it('summarize byDomain breakdown drops zero-instance entries', () => {
    const adapter = new TauBenchAdapter(makeMockModelAdapter(''));
    const verdicts = [
      { instanceId: 'a', domain: 'airline' as const, passed: true, toolCallCount: 2 },
      { instanceId: 'b', domain: 'retail' as const, passed: false, toolCallCount: 0, reason: 'empty' },
    ];
    const summary = adapter.summarize(verdicts, 200);
    const meta = summary.metadata as {
      byDomain: Record<string, { total: number; passed: number; passRate: number }>;
    };
    expect(meta.byDomain['airline']).toEqual({ total: 1, passed: 1, passRate: 1 });
    expect(meta.byDomain['retail']).toEqual({ total: 1, passed: 0, passRate: 0 });
  });
});

describe('extractToolCalls', () => {
  it('parses fenced JSON with explicit `json` tag', () => {
    const response = '```json\n[{"name": "foo", "arguments": {"x": 1}}]\n```';
    const calls = extractToolCalls(response);
    expect(calls).toEqual([{ name: 'foo', arguments: { x: 1 } }]);
  });

  it('parses fenced JSON with no language tag', () => {
    const response = '```\n[{"name": "bar", "arguments": {}}]\n```';
    const calls = extractToolCalls(response);
    expect(calls).toEqual([{ name: 'bar', arguments: {} }]);
  });

  it('parses raw JSON when no fence', () => {
    expect(extractToolCalls('[{"name": "baz", "arguments": {}}]')).toEqual([
      { name: 'baz', arguments: {} },
    ]);
  });

  it('drops entries missing the name field', () => {
    const response = '```json\n[{"name": "ok", "arguments": {}}, {"arguments": {}}, {}]\n```';
    expect(extractToolCalls(response)).toEqual([{ name: 'ok', arguments: {} }]);
  });

  it('coerces missing arguments to empty object', () => {
    const response = '```json\n[{"name": "noargs"}]\n```';
    expect(extractToolCalls(response)).toEqual([{ name: 'noargs', arguments: {} }]);
  });

  it('returns empty array for unrecognised responses', () => {
    expect(extractToolCalls('I cannot help.')).toEqual([]);
  });

  it('returns empty array when the JSON is not a tool-call array', () => {
    expect(extractToolCalls('```json\n{"not": "an array"}\n```')).toEqual([]);
  });
});

describe('prompt template', () => {
  it('system prompt asks for fenced JSON array', () => {
    const sys = getSystemPrompt();
    expect(sys).toContain('```json');
    expect(sys).toContain('snake_case');
    expect(sys).toContain('array');
  });

  it('user prompt includes scenario domain + user intent', () => {
    const prompt = composeUserPrompt(fixtureInstance);
    expect(prompt).toContain('airline');
    expect(prompt).toContain('Cancel my flight');
  });

  it('user prompt includes agent instructions when present', () => {
    const prompt = composeUserPrompt({ ...fixtureInstance, agentInstructions: 'BE NICE' });
    expect(prompt).toContain('BE NICE');
  });
});
