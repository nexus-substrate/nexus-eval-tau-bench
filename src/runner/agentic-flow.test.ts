/**
 * Tests for the v0.3 agentic-flow runner. Stub environment.
 */
import { describe, it, expect, vi } from 'vitest';
import { ok, type IModelAdapter, type ContentBlock } from 'nexus-agents';

import { runAgenticFlow } from './agentic-flow.js';
import type { TauBenchInstance } from '../types.js';

const fixtureInstance: TauBenchInstance = {
  instanceId: 'airline__cancel',
  domain: 'airline',
  userIntent: 'Cancel my flight ABC123.',
  expectedTools: ['lookup_booking', 'cancel_booking'],
};

interface ScriptedTurn {
  readonly toolCalls: readonly { id: string; name: string; input: Record<string, unknown> }[];
  readonly stop?: 'end_turn' | 'tool_use';
}

function makeScriptedModel(turns: readonly ScriptedTurn[]): IModelAdapter {
  let i = 0;
  const complete = vi.fn(() => {
    const turn = turns[i] ?? turns[turns.length - 1];
    i += 1;
    if (turn === undefined || turn.toolCalls.length === 0) {
      return Promise.resolve(
        ok({
          content: [{ type: 'text', text: 'done' }] as ContentBlock[],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          stopReason: 'end_turn' as const,
          model: 'mock',
        })
      );
    }
    return Promise.resolve(
      ok({
        content: turn.toolCalls.map((t) => ({
          type: 'tool_use' as const,
          id: t.id,
          name: t.name,
          input: t.input,
        })) as ContentBlock[],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        stopReason: turn.stop ?? ('tool_use' as const),
        model: 'mock',
      })
    );
  });
  return {
    providerId: 'anthropic',
    modelId: 'claude-mock',
    capabilities: [],
    complete: complete as never,
    stream: (() => (async function* () {})()) as never,
    countTokens: () => Promise.resolve(0),
    validateConfig: () => ({ ok: true as const, value: undefined }),
  };
}

describe('runAgenticFlow (tau-bench)', () => {
  it('records tool calls in emission order', async () => {
    const model = makeScriptedModel([
      {
        toolCalls: [
          { id: 't1', name: 'lookup_booking', input: { booking_id: 'ABC123' } },
          { id: 't2', name: 'cancel_booking', input: { booking_id: 'ABC123' } },
        ],
      },
      { toolCalls: [], stop: 'end_turn' },
    ]);
    const result = await runAgenticFlow(fixtureInstance, model, { turnBudget: 5 });
    expect(result.prediction.toolCalls.map((c) => c.name)).toEqual([
      'lookup_booking',
      'cancel_booking',
    ]);
    expect(result.transferredToHuman).toBe(false);
  });

  it('flags transferredToHuman when transfer_to_human_agents is called', async () => {
    const model = makeScriptedModel([
      {
        toolCalls: [{ id: 't1', name: 'transfer_to_human_agents', input: {} }],
      },
      { toolCalls: [], stop: 'end_turn' },
    ]);
    const result = await runAgenticFlow(fixtureInstance, model, { turnBudget: 5 });
    expect(result.transferredToHuman).toBe(true);
  });

  it('exposes the union of expectedTools + transfer_to_human_agents as tools', async () => {
    let capturedTools: ReadonlyArray<{ name: string }> | undefined;
    const model: IModelAdapter = {
      providerId: 'anthropic',
      modelId: 'claude-mock',
      capabilities: [],
      complete: vi.fn((req: { tools?: ReadonlyArray<{ name: string }> }) => {
        capturedTools = req.tools;
        return Promise.resolve(
          ok({
            content: [{ type: 'text', text: 'done' }] as ContentBlock[],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            stopReason: 'end_turn' as const,
            model: 'mock',
          })
        );
      }) as never,
      stream: (() => (async function* () {})()) as never,
      countTokens: () => Promise.resolve(0),
      validateConfig: () => ({ ok: true as const, value: undefined }),
    };
    await runAgenticFlow(fixtureInstance, model, { turnBudget: 5 });
    const names = (capturedTools ?? []).map((t) => t.name);
    expect(names).toContain('lookup_booking');
    expect(names).toContain('cancel_booking');
    expect(names).toContain('transfer_to_human_agents');
  });

  it('AbortSignal pre-set: cancels immediately', async () => {
    const ac = new AbortController();
    ac.abort();
    const model = makeScriptedModel([
      { toolCalls: [{ id: 't1', name: 'lookup_booking', input: {} }] },
    ]);
    const result = await runAgenticFlow(fixtureInstance, model, {
      turnBudget: 5,
      signal: ac.signal,
    });
    expect(result.agentRun.stopReason).toBe('cancelled');
  });
});
