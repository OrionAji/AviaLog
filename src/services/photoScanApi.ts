import { auth } from './firebase';
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
  const idToken = await currentUser.getIdToken();

  const resp = await fetch('/api/extract-flights-from-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      imageBase64,
      mimeType,
      knownAircraft: hints?.knownAircraft ?? [],
      knownMarks: hints?.knownMarks ?? [],
    }),
  });

  const payload = (await resp.json().catch(() => ({}))) as {
    flights?: RawPhotoFlightItem[];
    summaryNotes?: string;
    error?: string;
  };

  if (!resp.ok) {
    throw new Error(payload.error || `Photo scan failed (${resp.status}). Please try again.`);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const flights = normalizeExtractedPhotoFlights(payload.flights ?? [], todayIso);
  return {
    flights,
    summaryNotes: payload.summaryNotes ?? '',
  };
}
