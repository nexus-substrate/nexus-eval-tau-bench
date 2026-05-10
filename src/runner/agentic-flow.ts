/**
 * Agentic-flow runner for TAU-bench scenarios (v0.3 — stubbed environment).
 *
 * Bridges the IAgenticAdapter loop to a STUB toolset that records the
 * agent's tool calls + simulates plausible responses. This is NOT a
 * real grader — full grading requires running upstream's airline /
 * retail Python environment (v0.4 follow-up tracked at
 * [tau-bench#4](https://github.com/williamzujkowski/nexus-eval-tau-bench/issues/4)).
 *
 * Why ship the stub anyway:
 *
 * - Establishes the harness shape so v0.4 swaps the stub for the real
 *   environment behind the same IAgenticAdapter interface — drop-in.
 * - Captures the model's actual tool-call sequence (with arguments)
 *   instead of single-shot one-message-with-everything. The trace is
 *   more useful for routing decisions across model upgrades than the
 *   v0.2 model-only baseline.
 * - Pass/fail in v0.3 = "did the model call ≥1 expected tool from
 *   `instance.expectedTools`". Same as v0.2's coverage check, but now
 *   measured across an actual agent loop instead of a single prompt.
 *
 * Tools the stub exposes:
 *   - `<expected-tool>(...)` for each tool name in instance.expectedTools.
 *     The stub returns a generic "ok" response so the loop can continue.
 *   - `transfer_to_human_agents()` — for scenarios where the model decides
 *     it can't help. Tracked separately as a stop signal.
 *
 * @module runner/agentic-flow
 */

import {
  createAgenticAdapter,
  type AgentRunResult,
  type IModelAdapter,
  type AgenticToolCall as ToolCall,
  type AgenticToolResult as ToolResult,
} from 'nexus-agents';

import type { TauBenchInstance, TauBenchPrediction } from '../types.js';

export interface AgenticFlowResult {
  readonly prediction: TauBenchPrediction;
  readonly agentRun: AgentRunResult;
  readonly transferredToHuman: boolean;
}

export interface RunAgenticFlowOptions {
  readonly turnBudget?: number;
  readonly signal?: AbortSignal;
  readonly modelHints?: Parameters<typeof createAgenticAdapter>[1] extends infer Opts
    ? Opts extends { modelHints?: infer H }
      ? H
      : never
    : never;
}

const SYSTEM_PROMPT = `You are a customer-service agent operating in a tool-use environment.

Use the tools available to satisfy the customer's request. Each tool returns a result you can reason about. When you've fulfilled the request — or determined you can't — stop emitting tool calls.

Guidelines:
  - Look up information before quoting policy.
  - Confirm with the customer (via the conversation) before destructive actions.
  - If a request is out of scope, transfer to a human via transfer_to_human_agents.
  - Stop emitting tool calls when the request is resolved or transferred.
`;

export async function runAgenticFlow(
  instance: TauBenchInstance,
  modelAdapter: IModelAdapter,
  options: RunAgenticFlowOptions = {}
): Promise<AgenticFlowResult> {
  const startedAt = Date.now();
  const recordedToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let transferredToHuman = false;

  const tools = composeToolDefinitions(instance);

  const agentic = createAgenticAdapter(modelAdapter, {
    ...(options.modelHints !== undefined && { modelHints: options.modelHints }),
  });

  const userPrompt = composeAgentPrompt(instance);
  const onToolCall = (call: ToolCall): Promise<ToolResult> => {
    if (call.name === 'transfer_to_human_agents') {
      transferredToHuman = true;
    }
    recordedToolCalls.push({ name: call.name, arguments: call.arguments });
    return Promise.resolve(simulateToolResponse(call));
  };

  const result = await agentic.runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    tools,
    ...(options.turnBudget !== undefined && { turnBudget: options.turnBudget }),
    onToolCall,
    ...(options.signal !== undefined && { signal: options.signal }),
  });

  if (!result.ok) {
    throw new Error(`AgenticAdapter failed: ${result.error.message}`);
  }
  const agentRun = result.value;

  return {
    prediction: {
      instanceId: instance.instanceId,
      toolCalls: recordedToolCalls,
      modelLabel: modelAdapter.modelId,
      durationMs: Date.now() - startedAt,
    },
    agentRun,
    transferredToHuman,
  };
}

function composeAgentPrompt(instance: TauBenchInstance): string {
  const lines: string[] = [
    `Scenario: ${instance.instanceId}`,
    `Domain: ${instance.domain}`,
  ];
  if (instance.agentInstructions !== undefined) {
    lines.push('', 'Agent instructions:', instance.agentInstructions);
  }
  lines.push('', 'Customer request:', instance.userIntent);
  return lines.join('\n');
}

/**
 * Build ToolDefinition objects for each tool in `instance.expectedTools`
 * (plus the always-present `transfer_to_human_agents` escape hatch).
 *
 * v0.3 STUB: schemas are loose `{type: 'object'}` since we don't know
 * each tool's actual signature without reaching into the upstream
 * tau-bench environment. v0.4 will populate proper schemas from the
 * Python tool definitions.
 */
function composeToolDefinitions(
  instance: TauBenchInstance
): ReadonlyArray<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  const set = new Set<string>(instance.expectedTools);
  set.add('transfer_to_human_agents');
  return [...set].map((name) => ({
    name,
    description: `Stub for ${name} (v0.3). Real signature will be wired up in v0.4 against upstream tau-bench.`,
    inputSchema: { type: 'object', additionalProperties: true },
  }));
}

/**
 * v0.3 stub: simulate a generic "ok" response for any tool call. v0.4
 * delegates to upstream's airline / retail Python environment.
 */
function simulateToolResponse(call: ToolCall): ToolResult {
  if (call.name === 'transfer_to_human_agents') {
    return {
      content: 'Customer has been transferred to a human agent. Stop emitting tool calls.',
    };
  }
  return {
    content: `${call.name}(${JSON.stringify(call.arguments).slice(0, 200)}) → ok (v0.3 stub response)`,
  };
}
