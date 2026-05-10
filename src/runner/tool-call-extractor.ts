/**
 * Extract a tool-call array from a TAU-bench model response.
 *
 * Strategy:
 * 1. If the response contains a fenced ```json (or untagged ```) block,
 *    parse the body.
 * 2. Otherwise, try to parse the entire response as JSON.
 * 3. Return only entries that match the expected `{name, arguments}` shape.
 * 4. Return [] for unrecognised responses.
 *
 * @module runner/tool-call-extractor
 */

const FENCED_JSON_RE = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g;

export interface ToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export function extractToolCalls(response: string): ToolCall[] {
  const candidates: string[] = [];

  // 1. Fenced blocks (prefer the LAST — model often emits draft + final).
  FENCED_JSON_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCED_JSON_RE.exec(response)) !== null) {
    candidates.push(m[1] ?? '');
  }
  if (candidates.length > 0) {
    const parsed = tryParseToolCallArray(candidates[candidates.length - 1] ?? '');
    if (parsed !== null) return parsed;
  }

  // 2. Whole response as JSON.
  const whole = tryParseToolCallArray(response.trim());
  if (whole !== null) return whole;

  return [];
}

function tryParseToolCallArray(text: string): ToolCall[] | null {
  if (text.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: ToolCall[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e['name'] !== 'string' || e['name'].length === 0) continue;
    const args = e['arguments'];
    out.push({
      name: e['name'],
      arguments:
        typeof args === 'object' && args !== null && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {},
    });
  }
  return out;
}
