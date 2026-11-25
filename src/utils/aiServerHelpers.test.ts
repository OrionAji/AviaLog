import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRetryDelaySeconds,
  isAuthOrKeyError,
  isModelNotFoundError,
  isRateLimitError,
  normalizeAnalysisPayload,
  normalizeChatTurns,
  parseGeminiJson,
} from './aiServerHelpers.ts';

describe('Gemini error classifiers', () => {
  it('distinguishes 429 rate-limit, 403/API_KEY errors, and 400 non-key errors accurately', () => {
    const quotaErr = {
      status: 429,
      message: 'RESOURCE_EXHAUSTED: Please retry in 41.101628162s.',
    };
    assert.equal(isRateLimitError(quotaErr), true);
    assert.equal(isAuthOrKeyError(quotaErr), false);
    assert.equal(extractRetryDelaySeconds(quotaErr), 42);

    const generic400 = { status: 400, message: 'INVALID_ARGUMENT: bad schema field' };
    assert.equal(isAuthOrKeyError(generic400), false);

    const badKey400 = { status: 400, message: 'API_KEY_INVALID: API key not valid' };
    assert.equal(isAuthOrKeyError(badKey400), true);

    const notFound404 = { status: 404, message: 'Model not found' };
    assert.equal(isModelNotFoundError(notFound404), true);
  });
});

describe('parseGeminiJson', () => {
  it('parses both raw JSON and markdown-fenced JSON cleanly', () => {
    assert.deepEqual(parseGeminiJson('{"ok": true}'), { ok: true });
    assert.deepEqual(parseGeminiJson('```json\n{"ok": true, "n": 2}\n```'), { ok: true, n: 2 });
  });
});

describe('normalizeChatTurns', () => {
  it('coalesces consecutive user turns and drops leading model turns cleanly', () => {
    const res = normalizeChatTurns([
      { role: 'model', text: 'Welcome' },
      { role: 'user', text: 'First question' },
      { role: 'user', text: 'Follow up after retry' },
      { role: 'model', text: 'Answer' },
      { role: 'user', text: 'Next question' },
    ]);

    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.contents.length, 3);
      assert.equal(res.contents[0].role, 'user');
      assert.equal(res.contents[0].parts[0].text, 'First question\n\nFollow up after retry');
      assert.equal(res.contents[1].role, 'model');
      assert.equal(res.contents[2].role, 'user');
      assert.equal(res.contents[2].parts[0].text, 'Next question');
    }
  });

  it('rejects empty history or history ending in a model turn', () => {
    assert.equal(normalizeChatTurns([]).ok, false);
    assert.equal(normalizeChatTurns([{ role: 'user', text: 'Hi' }, { role: 'model', text: 'Hello' }]).ok, false);
  });
});

describe('normalizeAnalysisPayload', () => {
  it('safely fills defaults when optional or nested fields are omitted', () => {
    const normalized = normalizeAnalysisPayload({
      executiveSummary: 'Strong jet progression.',
      insights: [
        { category: 'Currency', title: '90d Recency', finding: '2 sorties logged', recommendation: 'Schedule night flight', metricRef: '90d · 2:25' },
      ],
    });

    assert.equal(normalized.executiveSummary, 'Strong jet progression.');
    assert.equal(normalized.readinessBrief.statusLabel, 'Logbook Summary');
    assert.deepEqual(normalized.readinessBrief.keyMetrics, []);
    assert.equal(normalized.insights.length, 1);
    assert.deepEqual(normalized.nextSortieFocus, []);
    assert.deepEqual(normalized.followUpQuestions, []);
  });
});
