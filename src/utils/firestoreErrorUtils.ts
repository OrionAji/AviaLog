export type FirestoreErrorCategory =
  | 'permission'
  | 'quota_free_read'
  | 'quota'
  | 'offline'
  | 'unauthenticated'
  | 'unknown';

export interface ParsedFirestoreDisplayError {
  category: FirestoreErrorCategory;
  message: string;
  details: string | null;
  upgradeUrl?: string;
}

interface RawFirestoreErrorJson {
  error?: string;
  operationType?: string;
  path?: string | null;
  authInfo?: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
  };
}

const FREE_DAILY_READ_QUOTA_MARKER =
  "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'";

export function parseFirestoreErrorForDisplay(
  error: unknown,
  fallbackMessage = 'Something went wrong while syncing your logbook.',
  config?: { projectId?: string; databaseId?: string }
): ParsedFirestoreDisplayError {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  let innerError = rawMessage;
  let details: string | null = rawMessage || null;

  try {
    const parsed = JSON.parse(rawMessage) as RawFirestoreErrorJson;
    if (parsed && typeof parsed.error === 'string') {
      innerError = parsed.error;
      details = `${parsed.operationType ?? 'operation'} on ${parsed.path ?? 'database'}: ${parsed.error}`;
    }
  } catch {
    // Non-JSON error message
  }

  const lower = innerError.toLowerCase();

  if (innerError.includes(FREE_DAILY_READ_QUOTA_MARKER)) {
    const upgradeUrl =
      config?.projectId && config?.databaseId
        ? `https://console.firebase.google.com/project/${encodeURIComponent(
            config.projectId
          )}/firestore/databases/${encodeURIComponent(config.databaseId)}/data?openUpgradeDialog=true`
        : undefined;
    return {
      category: 'quota_free_read',
      message:
        'Your Firestore free daily read quota has been reached for today. Quota resets tomorrow, or you can upgrade your Firebase plan in the console.',
      details,
      upgradeUrl,
    };
  }

  if (lower.includes('quota') || lower.includes('resource-exhausted') || lower.includes('resource_exhausted')) {
    return {
      category: 'quota',
      message:
        'Cloud Firestore daily usage quota has been reached. Free-tier quota resets the next day.',
      details,
    };
  }

  if (
    lower.includes('the client is offline') ||
    lower.includes('unavailable') ||
    lower.includes('network') ||
    lower.includes('failed to get document because the client is offline')
  ) {
    return {
      category: 'offline',
      message:
        'Could not reach your cloud logbook database. Check your internet connection or Firebase database configuration and try again.',
      details,
    };
  }

  if (lower.includes('unauthenticated') || lower.includes('auth/')) {
    return {
      category: 'unauthenticated',
      message: 'Your session expired. Sign out and sign back in to reconnect your private logbook.',
      details,
    };
  }

  if (lower.includes('permission') || lower.includes('insufficient permissions')) {
    return {
      category: 'permission',
      message:
        'Access to this record was denied by Firestore security rules. Ensure your email is verified and you are signed in to your own account.',
      details,
    };
  }

  return {
    category: 'unknown',
    message: fallbackMessage,
    details,
  };
}
