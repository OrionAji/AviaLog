import { getGenerativeModel, Schema, ThinkingLevel, type GenerationConfig } from 'firebase/ai';
import { ai, auth } from './firebase';
import {
  extractRetryDelaySeconds,
  isAuthOrKeyError,
  isModelNotFoundError,
  isRateLimitError,
  isTransientServerError,
  parseGeminiJson,
} from '../utils/aiServerHelpers';
import {
  normalizeExtractedPhotoFlights,
  type ExtractedPhotoFlight,
  type RawPhotoFlightItem,
} from '../utils/photoExtractParser';

export interface PhotoScanResponse {
  flights: ExtractedPhotoFlight[];
  summaryNotes: string;
}

const MAX_DIMENSION = 2048;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB decoded image limit
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const PRIMARY_GEMINI_MODEL = 'gemini-4-hydrogen';
const FALLBACK_GEMINI_MODEL = 'gemini-3.8-flash';
const MODEL_CANDIDATES = [PRIMARY_GEMINI_MODEL, FALLBACK_GEMINI_MODEL];

const SYSTEM_INSTRUCTION =
  'You are an expert aviation logbook transcription engine. Read printed or handwritten pilot logbooks, military flight authorization sheets, cockpit kneeboards, and flight summary slips with strict HH:MM time accuracy. Never invent flights that are not visible in the image.';

const FLIGHT_EXTRACTION_SCHEMA = Schema.object({
  properties: {
    summaryNotes: Schema.string({
      description:
        'Brief note about the scanned document (e.g., handwritten logbook page, 3 sorties found).',
    }),
    flights: Schema.array({
      description: 'Every flight sortie row visible in the image.',
      items: Schema.object({
        properties: {
          date: Schema.string({
            description:
              'Flight date formatted as YYYY-MM-DD if year is visible, or DD-MMM-YY as written.',
          }),
          aircraftType: Schema.string({
            description: 'Aircraft type code (e.g., A-JET, L-39ZA, K8-E, SMK, DA-40, C172).',
          }),
          aircraftMark: Schema.string({
            description:
              'Aircraft tail number, mark, or registration (e.g., NAF 455, NAF 357, 5N-ABC). Empty if absent.',
          }),
          engineCategory: Schema.string({
            description: 'One of SINGLE ENGINE, JET ENGINE, MULTI ENGINE, or SIMULATOR.',
          }),
          instructor: Schema.string({
            description: 'Instructor, captain, or PIC name/callsign. Empty if solo/absent.',
          }),
          exercise: Schema.string({
            description:
              'Exercise, mission, or sortie duty description (e.g., ARMED RECCE, FORMATION, NAVIGATION, CIRCUITS).',
          }),
          flightType: Schema.string({
            description: 'One of DUAL, SOLO, PIC, or SIMULATOR.',
          }),
          sortie: Schema.string({
            description:
              'Sortie number or identifier if listed (e.g., 1, 2, S-01, FLT-12), else empty string.',
          }),
          departure: Schema.string({
            description: 'Departure airfield / From location code if shown, else empty string.',
          }),
          arrival: Schema.string({
            description: 'Arrival airfield / To location code if shown, else empty string.',
          }),
          totalTime: Schema.string({
            description: 'Total flight duration in exact HH:MM format (e.g., 1:20, 0:55).',
          }),
          dualTime: Schema.string({
            description: 'Dual flight time in HH:MM format if separately listed, else empty string.',
          }),
          soloTime: Schema.string({
            description:
              'Solo / PIC flight time in HH:MM format if separately listed, else empty string.',
          }),
          nightTime: Schema.string({
            description: 'Night flight time in HH:MM format (e.g., 0:45), or 0:00 if none.',
          }),
          instrumentTime: Schema.string({
            description: 'Instrument flight time in HH:MM format (e.g., 0:20), or 0:00 if none.',
          }),
          simulatorTime: Schema.string({
            description: 'Simulator duration in HH:MM format if simulator sortie, else 0:00.',
          }),
          takeoffs: Schema.integer({
            description: 'Number of take-offs (default 1 if sortie occurred and count not listed).',
          }),
          landings: Schema.integer({
            description: 'Number of landings (default 1 if sortie occurred and count not listed).',
          }),
          approaches: Schema.integer({
            description: 'Number of instrument approaches (0 if none shown).',
          }),
          remarks: Schema.string({
            description: 'Any additional remarks or notes for the flight.',
          }),
          confidence: Schema.string({
            description: 'Extraction certainty for this row: high, medium, or low.',
          }),
        },
      }),
    }),
  },
});

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

function formatPhotoScanError(err: unknown): string {
  const rawMessage = err instanceof Error ? err.message : String(err ?? '');
  if (rawMessage.toLowerCase().includes('app check')) {
    return 'Firebase App Check verification is required for this AI model. Configure a reCAPTCHA Enterprise site key for App Check in Firebase Console.';
  }
  if (isRateLimitError(err)) {
    const retrySecs = extractRetryDelaySeconds(err);
    const waitHint = retrySecs
      ? `Please wait about ${retrySecs} seconds and try again.`
      : 'Please wait a moment and try again.';
    return `Gemini AI rate limit reached on the current tier. ${waitHint}`;
  }
  if (isAuthOrKeyError(err)) {
    return 'Firebase AI Logic permission error. Make sure Firebase AI Logic (Gemini Developer API) is enabled for this Firebase project.';
  }
  if (isModelNotFoundError(err)) {
    return 'The AI model is temporarily unavailable. Please try again in a moment.';
  }
  if (isTransientServerError(err)) {
    return 'Gemini AI is temporarily busy. Please wait a few seconds and try again.';
  }
  return rawMessage || 'Failed to extract flights from photo. Please try again.';
}

/**
 * Resizes/compresses large camera captures onto an offscreen canvas so handwritten
 * logbook figures stay legible while keeping uploads fast and well within limits.
 */
export async function prepareImageForUpload(
  file: Blob,
  fallbackMime = 'image/jpeg'
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image file.'));
      el.src = objectUrl;
    });

    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize image processor.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) {
      throw new Error('Failed to encode image.');
    }
    return {
      base64: dataUrl.slice(commaIdx + 1),
      mimeType: 'image/jpeg',
      previewUrl: dataUrl,
    };
  } catch {
    // Fallback for formats canvas cannot decode directly (e.g., HEIC on non-Safari browsers)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });
    const commaIdx = dataUrl.indexOf(',');
    const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
    return {
      base64: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl,
      mimeType: mimeMatch?.[1] || file.type || fallbackMime,
      previewUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function extractFlightsFromPhoto(
  imageBase64: string,
  mimeType: string,
  hints?: { knownAircraft?: string[]; knownMarks?: string[] }
): Promise<PhotoScanResponse> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in to scan flight photos.');
  }
  if (!currentUser.emailVerified) {
    throw new Error('Please verify your email address before trying to scan flight photos.');
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(
      'Unsupported image format. Please upload a JPEG, PNG, WebP, or HEIC picture.'
    );
  }
  if (!imageBase64 || imageBase64.length < 32) {
    throw new Error('No valid image data received.');
  }
  const approxBytes = Math.floor((imageBase64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large (max 10 MB). Please crop or choose a smaller picture.');
  }

  const aircraftHint = Array.isArray(hints?.knownAircraft)
    ? hints.knownAircraft
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 20)
        .join(', ')
    : '';
  const marksHint = Array.isArray(hints?.knownMarks)
    ? hints.knownMarks
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

  try {
    const { result } = await runWithModelFallback((modelName) => {
      const generationConfig: GenerationConfig = {
        responseMimeType: 'application/json',
        responseSchema: FLIGHT_EXTRACTION_SCHEMA,
        ...(modelName === PRIMARY_GEMINI_MODEL
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      };

      const model = getGenerativeModel(ai, {
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig,
      });

      return model.generateContent([
        {
          type: 'inlineData',
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        },
        {
          type: 'text',
          text: promptText,
        },
      ]);
    });

    const rawText = result.response.text().trim();
    if (!rawText) {
      throw new Error(
        'Could not read structured flight data from this picture. Try a clearer, well-lit photo.'
      );
    }

    let parsed: { flights?: RawPhotoFlightItem[]; summaryNotes?: string };
    try {
      parsed = parseGeminiJson<{ flights?: RawPhotoFlightItem[]; summaryNotes?: string }>(rawText);
    } catch {
      throw new Error('Received an unexpected format while reading the photo. Please try again.');
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const flights = normalizeExtractedPhotoFlights(
      Array.isArray(parsed.flights) ? parsed.flights : [],
      todayIso
    );
    return {
      flights,
      summaryNotes: typeof parsed.summaryNotes === 'string' ? parsed.summaryNotes : '',
    };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message.includes('Could not read structured flight data') ||
        err.message.includes('Received an unexpected format'))
    ) {
      throw err;
    }
    throw new Error(formatPhotoScanError(err));
  }
}
