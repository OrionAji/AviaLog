import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { CheckCircle2, Mail, RefreshCw } from 'lucide-react';
import fighterJetBackdrop from '../assets/images/fighter_jet_backdrop_1795445846538.jpg';
import {
  formatAuthErrorMessage,
  sendResetPasswordEmail,
  signInWithEmailAccount,
  signInWithGoogleAccount,
  signUpWithEmailAccount,
} from '../services/googleAuth';
import type { ThemeMode } from '../utils/theme';
import { ThemeToggle } from './ThemeToggle';

interface AuthGateProps {
  pendingVerificationUser: User | null;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onRefreshVerification: () => Promise<void>;
  onResendVerification: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

type AuthMode = 'signin' | 'signup' | 'reset';

export const AuthGate: React.FC<AuthGateProps> = ({
  pendingVerificationUser,
  theme,
  onToggleTheme,
  onRefreshVerification,
  onResendVerification,
  onSignOut,
}) => {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [pilotName, setPilotName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backdropFailed, setBackdropFailed] = useState(false);

  const handleGoogleContinue = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signInWithGoogleAccount();
    } catch (err) {
      setError(formatAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (mode === 'reset') {
      setBusy(true);
      try {
        await sendResetPasswordEmail(trimmedEmail);
        setNotice(
          `If an account exists for ${trimmedEmail}, a password reset link has been sent to your inbox.`
        );
      } catch (err) {
        setError(formatAuthErrorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (mode === 'signup') {
      if (!pilotName.trim()) {
        setError('Please enter your pilot name or callsign.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmailAccount(trimmedEmail, password, pilotName.trim());
        setNotice(
          `Account created. We sent a verification link to ${trimmedEmail} — verify your email to unlock your private logbook.`
        );
      } else {
        await signInWithEmailAccount(trimmedEmail, password);
      }
    } catch (err) {
      setError(formatAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshCheck = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await onRefreshVerification();
      setNotice('Checked verification status. If your email is verified, your logbook will open automatically.');
    } catch (err) {
      setError(formatAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await onResendVerification();
      setNotice(`Verification link resent to ${pendingVerificationUser?.email ?? 'your email'}.`);
    } catch (err) {
      setError(formatAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (pendingVerificationUser) {
    return (
      <div className="relative min-h-screen bg-[#F7F8FA] dark:bg-slate-950 flex items-center justify-center p-4 sm:p-6">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
            <span className="font-display text-lg font-bold tracking-tight text-[#0F1B2D] dark:text-white">
              AviaLog
            </span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Email Verification</span>
          </div>

          <div className="mt-6 flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 shrink-0 dark:bg-blue-950/70 dark:text-blue-300">
              <Mail className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Verify your email address
              </h1>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed dark:text-slate-400">
                We sent a confirmation link to{' '}
                <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                  {pendingVerificationUser.email}
                </span>
                . Verified accounts protect your private flight hours so no one else can access or modify your logbook.
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200"
            >
              {error}
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-200"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{notice}</span>
            </div>
          )}

          <div className="mt-6 space-y-2.5">
            <button
              type="button"
              onClick={handleRefreshCheck}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
              I&apos;ve Verified My Email
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={busy}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Resend Verification Email
            </button>

            <button
              type="button"
              onClick={() => void onSignOut()}
              disabled={busy}
              className="w-full rounded-lg px-4 py-2 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              Sign out &amp; switch account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] dark:bg-slate-950 flex flex-col lg:flex-row">
      {/* Left Brand Panel */}
      <div className="group relative overflow-hidden bg-[#0F1B2D] text-slate-100 px-6 py-10 sm:px-10 min-h-[240px] flex flex-col justify-between lg:w-[440px] lg:shrink-0 lg:min-h-0 lg:px-12 lg:py-12">
        {/* Military fighter jet subtly visible beneath the blue cover, revealed further on hover */}
        {!backdropFailed && (
          <img
            src={fighterJetBackdrop}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            onError={() => setBackdropFailed(true)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-55 scale-100 transition-[opacity,transform] duration-500 ease-out group-hover:opacity-85 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100 select-none"
          />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0F1B2D]/80 via-[#0F213D]/50 to-[#0B1524]/85 opacity-100 transition-opacity duration-500 ease-out group-hover:opacity-70 motion-reduce:transition-none"
        />

        {/* Foreground Brand & Logo Section */}
        <div className="relative z-10">
          <div
            aria-label="AviaLog logo"
            className="inline-flex items-center gap-3.5"
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-amber-200/30 bg-[#0F1B2D]/80 shadow-sm transition-[border-color,transform] duration-300 ease-out group-hover:border-amber-200/60 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <img
                src="/assets/aistudio/logo_AL_0a504ebc.webp"
                alt="AviaLog Pilot Logbook logo"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover select-none"
              />
            </div>
            <div>
              <span className="block font-display text-2xl font-bold tracking-tight text-white leading-none">
                AviaLog
              </span>
              <span className="mt-1 block text-[11px] font-medium tracking-wide text-blue-200/80">
                Flight Operations Ledger
              </span>
            </div>
          </div>

          <h1 className="mt-10 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white leading-tight text-balance">
            Electronic Pilot Flight Logbook
          </h1>
        </div>

        <p className="relative z-10 mt-10 text-[11px] text-slate-300/80">
          Private cloud-synced ledger · Exact HH:MM aviation accounting
        </p>
      </div>

      {/* Right Auth Form Panel */}
      <div className="relative flex-1 flex items-center justify-center p-4 sm:p-8 lg:p-12">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {/* Mode Switcher */}
          <div
            className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
            role="tablist"
            aria-label="Authentication mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => {
                setMode('signin');
                setError(null);
                setNotice(null);
              }}
              className={`rounded-md py-2 text-xs font-semibold transition-colors ${
                mode === 'signin'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => {
                setMode('signup');
                setError(null);
                setNotice(null);
              }}
              className={`rounded-md py-2 text-xs font-semibold transition-colors ${
                mode === 'signup'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="mt-6">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              {mode === 'signin'
                ? 'Sign in to your logbook'
                : mode === 'signup'
                  ? 'Create your private logbook'
                  : 'Reset your password'}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {mode === 'signin'
                ? 'Safe Haven for all your personal flight hours, monthly data and aircraft flown.'
                : mode === 'signup'
                  ? 'Start a private flight logbook using Google or any email address.'
                  : 'Enter your account email and we will send a password reset link.'}
            </p>
          </div>

          {mode !== 'reset' && (
            <>
              <button
                type="button"
                onClick={handleGoogleContinue}
                disabled={busy}
                className="mt-5 inline-flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-xs transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span>{mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}</span>
              </button>

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                </div>
                <div className="relative flex justify-center text-[11px]">
                  <span className="bg-white px-2.5 text-slate-400 dark:bg-slate-900 dark:text-slate-500">or use any email address</span>
                </div>
              </div>
            </>
          )}

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 leading-relaxed dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200"
            >
              {error}
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 leading-relaxed dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-200"
            >
              {notice}
            </div>
          )}

          <form onSubmit={handleEmailSubmit} className="space-y-4" noValidate>
            {mode === 'signup' && (
              <div>
                <label
                  htmlFor="auth-pilot-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Pilot Name / Callsign
                </label>
                <input
                  id="auth-pilot-name"
                  type="text"
                  autoComplete="name"
                  value={pilotName}
                  onChange={(e) => setPilotName(e.target.value)}
                  placeholder="e.g., Capt. Maya Lin"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pilot@example.com"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="auth-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset');
                        setError(null);
                        setNotice(null);
                      }}
                      className="text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-400"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                />
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Confirm Password
                </label>
                <input
                  id="auth-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
            >
              {busy
                ? 'Please wait...'
                : mode === 'signin'
                  ? 'Sign In with Email'
                  : mode === 'signup'
                    ? 'Create Private Account'
                    : 'Send Reset Link'}
            </button>

            {mode === 'reset' && (
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setNotice(null);
                }}
                className="w-full text-center text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Back to Sign In
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
