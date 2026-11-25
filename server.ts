import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  extractRetryDelaySeconds,
  isAuthOrKeyError,
  isModelNotFoundError,
  isRateLimitError,
  isTransientServerError,
  parseGeminiJson,
} from './src/utils/aiServerHelpers.ts';

const PRIMARY_GEMINI_MODEL = 'gemini-4-hydrogen';
const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const MODEL_CANDIDATES = [PRIMARY_GEMINI_MODEL, FALLBACK_GEMINI_MODEL];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB decoded image limit

let firebaseApiKey = '';
try {
  const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { apiKey?: string };
    firebaseApiKey = parsed.apiKey ?? '';
  }
} catch {
  firebaseApiKey = '';
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please check your key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; emailVerified: boolean } | null> {
  if (!firebaseApiKey || !idToken || idToken.length > 8192) return null;
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; emailVerified?: boolean }>;
    };
    const account = data.users?.[0];
    if (!account?.localId) return null;
    return {
      uid: account.localId,
      emailVerified: Boolean(account.emailVerified),
    };
  } catch {
    return null;
  }
}

const modelCooldownUntil = new Map<string, number>();

function getOrderedModels(): string[] {
  const now = Date.now();
  const ready = MODEL_CANDIDATES.filter((m) => (modelCooldownUntil.get(m) ?? 0) <= now);
  const cooling = MODEL_CANDIDATES.filter((m) => (modelCooldownUntil.get(m) ?? 0) > now).sort(
    (a, b) => (modelCooldownUntil.get(a) ?? 0) - (modelCooldownUntil.get(b) ?? 0)
  );
  return [...ready, ...cooling];
}

function recordModelCooldown(model: string, err: unknown) {
  if (isRateLimitError(err)) {
    const secs = extractRetryDelaySeconds(err) ?? 45;
    modelCooldownUntil.set(model, Date.now() + secs * 1000);
  } else if (isModelNotFoundError(err)) {
    modelCooldownUntil.set(model, Date.now() + 10 * 60 * 1000);
  }
}

function getModelThinkingConfig(model: string) {
  return model === PRIMARY_GEMINI_MODEL
    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
    : {};
}

async function generateWithRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (isRateLimitError(err) || isAuthOrKeyError(err) || isModelNotFoundError(err)) {
        throw err;
      }
      if (!isTransientServerError(err) || attempt === maxAttempts - 1) {
        throw err;
      }
      const delayMs = 600 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function runWithModelFallback<T>(
  runner: (model: string) => Promise<T>
): Promise<{ result: T; modelUsed: string }> {
  const models = getOrderedModels();
  let lastError: unknown;

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    try {
      const result = await generateWithRetry(() => runner(model));
      return { result, modelUsed: model };
    } catch (err: unknown) {
      lastError = err;
      recordModelCooldown(model, err);
      const canFallback =
        i < models.length - 1 &&
        (isRateLimitError(err) || isTransientServerError(err) || isModelNotFoundError(err));
      if (!canFallback) {
        throw err;
      }
      console.warn(`Model ${model} unavailable or rate-limited; falling back to ${models[i + 1]}.`);
    }
  }

  throw lastError;
}

const FLIGHT_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summaryNotes: {
      type: Type.STRING,
      description: 'Brief note about the scanned document (e.g., handwritten logbook page, 3 sorties found).',
    },
    flights: {
      type: Type.ARRAY,
      description: 'Every flight sortie row visible in the image.',
      items: {
        type: Type.OBJECT,
        properties: {
          date: {
            type: Type.STRING,
            description: 'Flight date formatted as YYYY-MM-DD if year is visible, or DD-MMM-YY as written.',
          },
          aircraftType: {
            type: Type.STRING,
            description: 'Aircraft type code (e.g., A-JET, L-39ZA, K8-E, SMK, DA-40, C172).',
          },
          aircraftMark: {
            type: Type.STRING,
            description: 'Aircraft tail number, mark, or registration (e.g., NAF 455, NAF 357, 5N-ABC). Empty if absent.',
          },
          engineCategory: {
            type: Type.STRING,
            description: 'One of SINGLE ENGINE, JET ENGINE, MULTI ENGINE, or SIMULATOR.',
          },
          instructor: {
            type: Type.STRING,
            description: 'Instructor, captain, or PIC name/callsign. Empty if solo/absent.',
          },
          exercise: {
            type: Type.STRING,
            description: 'Exercise, mission, or sortie duty description (e.g., ARMED RECCE, FORMATION, NAVIGATION, CIRCUITS).',
          },
          flightType: {
            type: Type.STRING,
            description: 'One of DUAL, SOLO, PIC, or SIMULATOR.',
          },
          sortie: {
            type: Type.STRING,
            description: 'Sortie number or identifier if listed (e.g., 1, 2, S-01, FLT-12), else empty string.',
          },
          departure: {
            type: Type.STRING,
            description: 'Departure airfield / From location code if shown, else empty string.',
          },
          arrival: {
            type: Type.STRING,
            description: 'Arrival airfield / To location code if shown, else empty string.',
          },
          totalTime: {
            type: Type.STRING,
            description: 'Total flight duration in exact HH:MM format (e.g., 1:20, 0:55).',
          },
          dualTime: {
            type: Type.STRING,
            description: 'Dual flight time in HH:MM format if separately listed, else empty string.',
          },
          soloTime: {
            type: Type.STRING,
            description: 'Solo / PIC flight time in HH:MM format if separately listed, else empty string.',
          },
          nightTime: {
            type: Type.STRING,
            description: 'Night flight time in HH:MM format (e.g., 0:45), or 0:00 if none.',
          },
          instrumentTime: {
            type: Type.STRING,
            description: 'Instrument flight time in HH:MM format (e.g., 0:20), or 0:00 if none.',
          },
          simulatorTime: {
            type: Type.STRING,
            description: 'Simulator duration in HH:MM format if simulator sortie, else 0:00.',
          },
          takeoffs: {
            type: Type.INTEGER,
            description: 'Number of take-offs (default 1 if sortie occurred and count not listed).',
          },
          landings: {
            type: Type.INTEGER,
            description: 'Number of landings (default 1 if sortie occurred and count not listed).',
          },
          approaches: {
            type: Type.INTEGER,
            description: 'Number of instrument approaches (0 if none shown).',
          },
          remarks: {
            type: Type.STRING,
            description: 'Any additional remarks or notes for the flight.',
          },
          confidence: {
            type: Type.STRING,
            description: 'Extraction certainty for this row: high, medium, or low.',
          },
        },
      },
    },
  },
};

async function requireVerifiedUser(
  req: express.Request,
  res: express.Response,
  actionLabel: string
): Promise<{ uid: string; emailVerified: boolean } | null> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const verifiedUser = await verifyFirebaseIdToken(token);
  if (!verifiedUser) {
    res.status(401).json({
      error: `Authentication required. Please sign in to ${actionLabel}.`,
    });
    return null;
  }
  if (!verifiedUser.emailVerified) {
    res.status(403).json({
      error: `Please verify your email address before trying to ${actionLabel}.`,
    });
    return null;
  }
  return verifiedUser;
}

function formatUserFacingGeminiError(err: unknown, fallbackMsg: string): {
  status: number;
  error: string;
  retryAfterSeconds?: number;
} {
  if (isRateLimitError(err)) {
    const retrySecs = extractRetryDelaySeconds(err);
    const waitHint = retrySecs
      ? `Please wait about ${retrySecs} seconds and try again.`
      : 'Please wait a moment and try again.';
    return {
      status: 429,
      retryAfterSeconds: retrySecs ?? undefined,
      error: `Gemini API rate limit reached on the current tier. ${waitHint} For higher limits, select a billing-enabled API key in Settings > Secrets.`,
    };
  }
  if (isAuthOrKeyError(err)) {
    return {
      status: 403,
      error: 'AI service key error. Please check your Gemini API key in Settings > Secrets.',
    };
  }
  if (isModelNotFoundError(err)) {
    return {
      status: 503,
      error: 'The AI model is temporarily unavailable. Please try again in a moment.',
    };
  }
  if (isTransientServerError(err)) {
    return {
      status: 503,
      error: 'Gemini AI is temporarily busy. Please wait a few seconds and try again.',
    };
  }
  return { status: 500, error: fallbackMsg };
}

function sendGeminiError(res: express.Response, err: unknown, fallbackMsg: string) {
  const formatted = formatUserFacingGeminiError(err, fallbackMsg);
  if (formatted.retryAfterSeconds) {
    res.setHeader('Retry-After', String(formatted.retryAfterSeconds));
  }
  return res.status(formatted.status).json({
    error: formatted.error,
    retryAfterSeconds: formatted.retryAfterSeconds,
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/favicon.ico', (_req, res) => {
    const webpIconPath = path.resolve(__dirname, 'public/assets/aistudio/logo_AL_0a504ebc.webp');
    if (fs.existsSync(webpIconPath)) {
      res.type('image/webp');
      return res.sendFile(webpIconPath);
    }
    const pngIconPath = path.resolve(__dirname, 'public/assets/aistudio/image_5ba78f21.png');
    if (fs.existsSync(pngIconPath)) {
      res.type('image/png');
      return res.sendFile(pngIconPath);
    }
    return res.status(204).end();
  });

  app.post('/api/extract-flights-from-image', async (req, res) => {
    try {
      const verifiedUser = await requireVerifiedUser(req, res, 'scan flight photos');
      if (!verifiedUser) return;

      const { imageBase64, mimeType, knownAircraft, knownMarks } = req.body as {
        imageBase64?: unknown;
        mimeType?: unknown;
        knownAircraft?: unknown;
        knownMarks?: unknown;
      };

      if (typeof mimeType !== 'string' || !ALLOWED_MIME_TYPES.has(mimeType)) {
        return res.status(400).json({
          error: 'Unsupported image format. Please upload a JPEG, PNG, WebP, or HEIC picture.',
        });
      }
      if (typeof imageBase64 !== 'string' || imageBase64.length < 32) {
        return res.status(400).json({ error: 'No valid image data received.' });
      }

      const approxBytes = Math.floor((imageBase64.length * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return res.status(400).json({
          error: 'Image is too large (max 10 MB). Please crop or choose a smaller picture.',
        });
      }

      const aircraftHint = Array.isArray(knownAircraft)
        ? knownAircraft
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .slice(0, 20)
            .join(', ')
        : '';
      const marksHint = Array.isArray(knownMarks)
        ? knownMarks
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .slice(0, 30)
            .join(', ')
        : '';

      const promptText = [
        'Extract every flight logbook entry visible in this image.',
        'Ignore page subtotal/brought-forward/carried-forward/grand-total summary rows — extract individual flight sorties only.',
        'Format all durations strictly as HH:MM (e.g., 1:20, 0:55). Convert decimal hours (e.g., 1.5 -> 1:30) if needed.',
        'Pay close attention to Aircraft Type, Aircraft Mark / Tail Number (e.g., NAF 455, NAF 357), Sortie number, and From / To airfields.',
        aircraftHint ? `Known aircraft types in this pilot's fleet: ${aircraftHint}.` : '',
        marksHint ? `Known aircraft marks in this pilot's fleet: ${marksHint}.` : '',
        'If no flight rows are visible or the image is unreadable, return an empty flights array and explain briefly in summaryNotes.',
      ]
        .filter(Boolean)
        .join('\n');

      const ai = getGeminiClient();
      const { result: response } = await runWithModelFallback((model) =>
        ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
              { text: promptText },
            ],
          },
          config: {
            ...getModelThinkingConfig(model),
            systemInstruction:
              'You are an expert aviation logbook transcription engine. Read printed or handwritten pilot logbooks, military flight authorization sheets, cockpit kneeboards, and flight summary slips with strict HH:MM time accuracy. Never invent flights that are not visible in the image.',
            responseMimeType: 'application/json',
            responseSchema: FLIGHT_EXTRACTION_SCHEMA,
          },
        })
      );

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        return res.status(502).json({
          error: 'Could not read structured flight data from this picture. Try a clearer, well-lit photo.',
        });
      }

      let parsed: { flights?: unknown[]; summaryNotes?: string };
      try {
        parsed = parseGeminiJson<{ flights?: unknown[]; summaryNotes?: string }>(rawText);
      } catch {
        return res.status(502).json({
          error: 'Received an unexpected format while reading the photo. Please try again.',
        });
      }

      return res.json({
        flights: Array.isArray(parsed.flights) ? parsed.flights : [],
        summaryNotes: typeof parsed.summaryNotes === 'string' ? parsed.summaryNotes : '',
      });
    } catch (err: unknown) {
      if (isRateLimitError(err)) {
        console.warn('Rate limit reached in /api/extract-flights-from-image.');
      } else {
        const message = err instanceof Error ? err.message : 'Failed to extract flights from photo.';
        console.error('Error in /api/extract-flights-from-image:', message);
      }
      return sendGeminiError(res, err, 'Failed to extract flights from photo.');
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AviaLog server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
