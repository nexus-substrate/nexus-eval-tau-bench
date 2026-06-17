/**
 * Tests for the tool-call extractor, including ReDoS hardening
 * (CodeQL js/polynomial-redos) on untrusted model output.
 */
import { describe, it, expect } from 'vitest';

import { extractToolCalls } from './tool-call-extractor.js';

describe('extractToolCalls — legitimate extraction', () => {
  it('extracts a fenced ```json block', () => {
    const response = [
      'Here is the plan:',
      '```json',
      '[{"name": "lookup_booking", "arguments": {"id": "ABC123"}}]',
      '```',
    ].join('\n');
    expect(extractToolCalls(response)).toEqual([
      { name: 'lookup_booking', arguments: { id: 'ABC123' } },
    ]);
  });

  it('extracts an untagged ``` block', () => {
    const response = ['```', '[{"name": "cancel_booking", "arguments": {}}]', '```'].join('\n');
    expect(extractToolCalls(response)).toEqual([{ name: 'cancel_booking', arguments: {} }]);
  });

  it('prefers the LAST fenced block (draft + final)', () => {
    const response = [
      '```json',
      '[{"name": "draft", "arguments": {}}]',
      '```',
      'On reflection:',
      '```json',
      '[{"name": "final", "arguments": {"ok": true}}]',
      '```',
    ].join('\n');
    expect(extractToolCalls(response)).toEqual([{ name: 'final', arguments: { ok: true } }]);
  });

  it('parses a whole-response JSON array with no fence', () => {
    const response = '  [{"name": "noop", "arguments": {}}]  ';
    expect(extractToolCalls(response)).toEqual([{ name: 'noop', arguments: {} }]);
  });

  it('tolerates inline whitespace after the language tag', () => {
    const response = '```json   \n[{"name": "t", "arguments": {}}]\n```';
    expect(extractToolCalls(response)).toEqual([{ name: 't', arguments: {} }]);
  });

  it('handles CRLF line endings', () => {
    const response = '```json\r\n[{"name": "t", "arguments": {}}]\r\n```';
    expect(extractToolCalls(response)).toEqual([{ name: 't', arguments: {} }]);
  });

  it('returns [] for unrecognised responses', () => {
    expect(extractToolCalls('I cannot help with that.')).toEqual([]);
    expect(extractToolCalls('')).toEqual([]);
  });

  it('drops entries that do not match {name, arguments}', () => {
    const response = '```json\n[{"name": ""}, {"foo": 1}, {"name": "ok"}]\n```';
    expect(extractToolCalls(response)).toEqual([{ name: 'ok', arguments: {} }]);
  });
});

describe('extractToolCalls — ReDoS hardening', () => {
  it('runs in bounded time on ~200k-char adversarial input', () => {
    // An open fence followed by a long run of newline+whitespace pairs and
    // never a close fence. The old `\s*\n` quantifier overlap combined with
    // the unbounded `[\s\S]*?` search exhibited polynomial backtracking on
    // this shape (~1.3 s for 100k pairs); the fix keeps it well under 250 ms.
    const adversarial = '```json' + '\n '.repeat(100_000);
    expect(adversarial.length).toBeGreaterThan(200_000);

    const start = performance.now();
    const result = extractToolCalls(adversarial);
    const elapsed = performance.now() - start;

    expect(result).toEqual([]);
    expect(elapsed).toBeLessThan(250);
  });

  it('still extracts a valid block after a large non-fence preamble', () => {
    const filler = 'reasoning '.repeat(2_000); // ~20 KB, no fences
    const response = `${filler}\n\`\`\`json\n[{"name": "ok", "arguments": {}}]\n\`\`\``;
    const start = performance.now();
    const result = extractToolCalls(response);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(250);
    // The valid block lives within the first 64 KB, so it is still found.
    expect(result).toEqual([{ name: 'ok', arguments: {} }]);
  });
});
