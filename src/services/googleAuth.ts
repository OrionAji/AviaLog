import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

export const WORKSPACE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const googleBasicProvider = new GoogleAuthProvider();
googleBasicProvider.setCustomParameters({ prompt: 'select_account' });

const googleSheetsProvider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  googleSheetsProvider.addScope(scope);
}
googleSheetsProvider.setCustomParameters({
  prompt: 'consent select_account',
  include_granted_scopes: 'true',
});

// Strictly in-memory Google Sheets OAuth access token cache (never persisted to localStorage/sessionStorage or Firestore).
let cachedAccessToken: string | null = null;

export function onAuthSessionChanged(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
    }
    callback(user);
  });
}

export async function signInWithGoogleAccount(): Promise<User> {
  const result = await signInWithPopup(auth, googleBasicProvider);
  return result.user;
}

export async function signUpWithEmailAccount(
  email: string,
  password: string,
  pilotName: string
): Promise<User> {
  const trimmedEmail = email.trim();
  const trimmedName = pilotName.trim();
  const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
  if (trimmedName) {
    await updateProfile(cred.user, { displayName: trimmedName.slice(0, 80) });
  }
  await sendEmailVerification(cred.user);
  return cred.user;
}

export async function signInWithEmailAccount(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function sendResetPasswordEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerificationEmail(): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('No active user session found.');
  }
  await sendEmailVerification(auth.currentUser);
}

export async function refreshCurrentUserVerification(): Promise<User | null> {
  if (!auth.currentUser) return null;
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  return auth.currentUser;
}

/**
 * Authorizes Google Sheets access for the ALREADY signed-in user without switching UIDs.
 * - If signed in with Google: re-authenticates with the spreadsheets scope on the same account.
 * - If signed in with Email/Password: links Google to the existing account to obtain a Sheets token.
 */
export async function connectGoogleSheetsAccess(): Promise<{ user: User; accessToken: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in to your AviaLog account before connecting Google Sheets.');
  }

  const hasGoogleProvider = currentUser.providerData.some((p) => p.providerId === 'google.com');
  const result = hasGoogleProvider
    ? await reauthenticateWithPopup(currentUser, googleSheetsProvider)
    : await linkWithPopup(currentUser, googleSheetsProvider);

  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Could not retrieve Google Sheets access permission. Please try again.');
  }

  cachedAccessToken = credential.accessToken;
  return { user: result.user, accessToken: cachedAccessToken };
}

export function getAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearAccessToken(): void {
  cachedAccessToken = null;
}

export async function signOutAccount(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}

export function formatAuthErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before completing.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Please allow popups and try again.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password. Please check your credentials and try again.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/operation-not-allowed':
      return 'Email & Password sign-in is not enabled yet in your Firebase project. Enable Email/Password in Firebase Console -> Authentication -> Sign-in method, or sign in with Google.';
    case 'auth/unauthorized-domain':
      return 'This app domain is not authorized in Firebase Authentication yet. Add the current hostname under Firebase Console -> Authentication -> Settings -> Authorized domains.';
    case 'auth/network-request-failed':
      return 'Network error while reaching Firebase Authentication. Please check your connection and try again.';
    case 'auth/credential-already-in-use':
      return 'That Google account is already linked to another AviaLog user. Sign in with that Google account directly to keep accounts strictly isolated.';
    default:
      return (err as { message?: string })?.message || 'Authentication failed. Please try again.';
  }
}
