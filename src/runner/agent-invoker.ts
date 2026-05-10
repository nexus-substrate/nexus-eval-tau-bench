/**
 * Generate one TAU-bench prediction by calling an `IModelAdapter`
 * with the scenario prompt and parsing the tool-call plan from the response.
 *
 * v0.1 scope: model-only baseline, single round-trip. v0.3 follow-up
 * will plug in `ICliAdapter` for the full multi-turn agentic flow
 * against tau-bench's stateful environment.
 *
 * @module runner/agent-invoker
 */

import { ok, err, type IModelAdapter, type Result } from 'nexus-agents';

import type { TauBenchInstance, TauBenchPrediction } from '../types.js';
import { extractToolCalls } from './tool-call-extractor.js';
import { composeUserPrompt, getSystemPrompt } from './prompt-template.js';

export interface GeneratePredictionOptions {
  readonly timeoutMs?: number;
  readonly modelLabel?: string;
}

export async function generatePrediction(
  instance: TauBenchInstance,
  modelAdapter: IModelAdapter,
  options: GeneratePredictionOptions = {}
): Promise<Result<TauBenchPrediction, Error>> {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const modelLabel = options.modelLabel ?? modelAdapter.modelId;

  const start = Date.now();
  try {
    const completion = await Promise.race([
      modelAdapter.complete({
        messages: [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: composeUserPrompt(instance) },
        ],
      }),
      timeoutAfter<never>(timeoutMs, `model call exceeded ${String(timeoutMs)}ms`),
    ]);

    if (!completion.ok) {
      return err(new Error(completion.error.message));
    }
    const responseText = extractResponseText(completion.value);
    const toolCalls = extractToolCalls(responseText);

    return ok({
      instanceId: instance.instanceId,
      toolCalls,
      modelLabel,
      durationMs: Date.now() - start,
    });
  } catch (caught: unknown) {
    return err(caught instanceof Error ? caught : new Error(String(caught)));
  }
}

function timeoutAfter<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    const handle = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    handle.unref?.();
  });
}

function extractResponseText(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const obj = value as Record<string, unknown>;
  if (typeof obj['content'] === 'string') return obj['content'];
  if (typeof obj['text'] === 'string') return obj['text'];
  if (Array.isArray(obj['choices']) && obj['choices'].length > 0) {
    const first = obj['choices'][0] as { message?: { content?: unknown } } | undefined;
    if (
      first !== undefined &&
      typeof first.message === 'object' &&
      first.message !== null &&
      typeof first.message.content === 'string'
    ) {
      return first.message.content;
    }
  }
  return '';
}
