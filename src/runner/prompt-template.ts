/**
 * Prompt composition for TAU-bench scenarios.
 *
 * v0.1 asks the model for a JSON array of intended tool calls — no
 * actual tool execution, no multi-turn dialogue. v0.3 will replace
 * this with a real agent loop driven by ICliAdapter against the
 * upstream tau-bench environment.
 *
 * @module runner/prompt-template
 */

import type { TauBenchInstance } from '../types.js';

const SYSTEM_PROMPT = `You are a customer-service agent operating in a tool-use environment.

You will receive:
1. The customer's natural-language request.
2. Any agent-side instructions (company policy etc).
3. The scenario domain (airline or retail).

Produce the sequence of tool calls you would make to satisfy the request. Output a SINGLE fenced JSON code block containing an ARRAY of tool-call objects:

\`\`\`json
[
  {"name": "<tool_name>", "arguments": {"key": "value"}},
  {"name": "<tool_name>", "arguments": {}}
]
\`\`\`

Rules:

- Output ONLY the fenced JSON block. No prose before or after.
- Tool names should be \`snake_case\` strings (e.g., \`lookup_booking\`, \`process_refund\`).
- Even if the answer is "do nothing", emit an empty array \`[]\`.
- Do not invent tool calls outside the scenario's plausible toolset.

Example for an airline scenario:

\`\`\`json
[
  {"name": "lookup_booking", "arguments": {"booking_id": "ABC123"}},
  {"name": "check_cancellation_policy", "arguments": {"booking_id": "ABC123"}},
  {"name": "issue_credit", "arguments": {"booking_id": "ABC123", "amount_usd": 250}}
]
\`\`\`
`;

export function composeUserPrompt(instance: TauBenchInstance): string {
  const lines: string[] = [
    `Scenario: ${instance.instanceId}`,
    `Domain: ${instance.domain}`,
  ];
  if (instance.agentInstructions !== undefined) {
    lines.push('', 'Agent instructions:', instance.agentInstructions);
  }
  lines.push('', 'Customer request:', instance.userIntent);
  lines.push('', 'Emit your tool-call plan now.');
  return lines.join('\n');
}

export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
