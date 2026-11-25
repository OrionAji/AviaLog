export interface SanitizedGeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export interface NormalizedAnalysis {
  executiveSummary: string;
  readinessBrief: {
    statusLabel: string;
    summary: string;
    keyMetrics: string[];
  };
  insights: Array<{
    category: string;
    title: string;
    finding: string;
    recommendation: string;
    metricRef: string;
  }>;
  nextSortieFocus: string[];
  followUpQuestions: string[];
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err ?? '');
}

export function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429) return true;
  const msg = getErrorMessage(err);
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('"code":429') ||
    msg.toLowerCase().includes('quota exceeded') ||
    msg.toLowerCase().includes('rate limit')
  );
}

export function isAuthOrKeyError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 403) return true;
  const msg = getErrorMessage(err);
  return (
    msg.includes('API_KEY_INVALID') ||
    msg.includes('GEMINI_API_KEY') ||
    msg.includes('API key not valid') ||
    msg.includes('PERMISSION_DENIED')
  );
}

export function isModelNotFoundError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 404) return true;
  const msg = getErrorMessage(err);
  return msg.includes('NOT_FOUND') && msg.toLowerCase().includes('model');
}

export function isTransientServerError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number' && status >= 500) return true;
  const msg = getErrorMessage(err);
  return msg.includes('UNAVAILABLE') || msg.includes('INTERNAL') || msg.includes('overloaded');
}

export function extractRetryDelaySeconds(err: unknown): number | null {
  const msg = getErrorMessage(err);
  const match =
    msg.match(/retry in\s+(\d+(?:\.\d+)?)s/i) ||
    msg.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (!match) return null;
  const secs = Math.ceil(Number(match[1]));
  return Number.isFinite(secs) && secs > 0 ? Math.min(secs, 120) : null;
}

/**
 * Parses JSON returned by Gemini, cleanly stripping optional markdown code fences
 * (e.g. ```json ... ```) if present.
 */
export function parseGeminiJson<T = unknown>(rawText: string): T {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return JSON.parse(cleaned) as T;
}

/**
 * Validates chat messages and normalizes them into strict alternating user/model turns
 * ending with a user turn so Gemini never rejects consecutive same-role turns with 400.
 */
export function normalizeChatTurns(
  rawMessages: unknown,
  maxMessages = 20,
  maxCharsPerMessage = 4000
): { ok: true; contents: SanitizedGeminiContent[] } | { ok: false; error: string } {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > maxMessages) {
    return { ok: false, error: `Provide between 1 and ${maxMessages} chat messages.` };
  }

  const parsed: Array<{ role: 'user' | 'model'; text: string }> = [];
  for (const item of rawMessages) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Invalid chat message structure.' };
    }
    const role = (item as { role?: unknown }).role;
    const text = (item as { text?: unknown }).text;
    if ((role !== 'user' && role !== 'model') || typeof text !== 'string') {
      return { ok: false, error: 'Each message must include a valid role and text.' };
    }
    const trimmed = text.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxCharsPerMessage) {
      return {
        ok: false,
        error: `Each message must be under ${maxCharsPerMessage} characters.`,
      };
    }
    parsed.push({ role, text: trimmed });
  }

  // Drop any leading model messages (Gemini multi-turn history must begin with 'user')
  while (parsed.length > 0 && parsed[0].role === 'model') {
    parsed.shift();
  }

  if (parsed.length === 0) {
    return { ok: false, error: 'Please enter a message before sending.' };
  }

  // Coalesce consecutive same-role messages so turns strictly alternate user <-> model
  const merged: SanitizedGeminiContent[] = [];
  for (const turn of parsed) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) {
      prev.parts[0].text = `${prev.parts[0].text}\n\n${turn.text}`.slice(0, maxCharsPerMessage * 2);
    } else {
      merged.push({ role: turn.role, parts: [{ text: turn.text }] });
    }
  }

  if (merged[merged.length - 1]?.role !== 'user') {
    return { ok: false, error: 'The latest chat message must be from the user.' };
  }

  return { ok: true, contents: merged };
}

/**
 * Defensively normalizes structured analysis JSON from Gemini so the UI
 * never crashes on missing/partial properties or non-array fields.
 */
export function normalizeAnalysisPayload(raw: unknown): NormalizedAnalysis {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rb =
    obj.readinessBrief && typeof obj.readinessBrief === 'object'
      ? (obj.readinessBrief as Record<string, unknown>)
      : {};

  const toStringArray = (val: unknown, limit = 8): string[] =>
    Array.isArray(val)
      ? val
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
          .slice(0, limit)
      : [];

  const rawInsights = Array.isArray(obj.insights) ? obj.insights : [];
  const insights = rawInsights
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .slice(0, 8)
    .map((item) => ({
      category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : 'General',
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Logbook Observation',
      finding: typeof item.finding === 'string' ? item.finding.trim() : '',
      recommendation: typeof item.recommendation === 'string' ? item.recommendation.trim() : '',
      metricRef: typeof item.metricRef === 'string' ? item.metricRef.trim() : '',
    }))
    .filter((ins) => ins.finding.length > 0 || ins.recommendation.length > 0);

  return {
    executiveSummary:
      typeof obj.executiveSummary === 'string' && obj.executiveSummary.trim()
        ? obj.executiveSummary.trim()
        : 'Logbook analysis completed.',
    readinessBrief: {
      statusLabel:
        typeof rb.statusLabel === 'string' && rb.statusLabel.trim()
          ? rb.statusLabel.trim()
          : 'Logbook Summary',
      summary: typeof rb.summary === 'string' ? rb.summary.trim() : '',
      keyMetrics: toStringArray(rb.keyMetrics, 6),
    },
    insights,
    nextSortieFocus: toStringArray(obj.nextSortieFocus, 6),
    followUpQuestions: toStringArray(obj.followUpQuestions, 6),
  };
}
