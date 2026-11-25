import React from 'react';
import { AlertTriangle, ExternalLink, LogOut, RefreshCw } from 'lucide-react';
import { firebaseProjectId, firestoreDatabaseId } from '../services/firebase';
import { signOutAccount } from '../services/googleAuth';
import { parseFirestoreErrorForDisplay } from '../utils/firestoreErrorUtils';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  details: string | null;
  upgradeUrl?: string;
  signingOut: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      details: null,
      upgradeUrl: undefined,
      signingOut: false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const parsed = parseFirestoreErrorForDisplay(
      error,
      'Something went wrong while loading your logbook.',
      {
        projectId: firebaseProjectId,
        databaseId: firestoreDatabaseId,
      }
    );

    return {
      hasError: true,
      message: parsed.message,
      details: parsed.details,
      upgradeUrl: parsed.upgradeUrl,
      signingOut: false,
    };
  }

  componentDidCatch(error: Error) {
    console.error('AviaLog ErrorBoundary caught error:', error);
  }

  private handleSignOutRecovery = async () => {
    this.setState({ signingOut: true });
    try {
      await signOutAccount();
    } catch {
      // Proceed to reload even if sign-out fails offline
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#F7F8FA] dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-700 shrink-0 dark:bg-red-950/70 dark:text-red-300">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Logbook Error
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Your flight records remain safely stored.
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-700 leading-relaxed dark:text-slate-300">
            {this.state.message}
          </p>

          {this.state.upgradeUrl && (
            <div className="mt-3">
              <a
                href={this.state.upgradeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
              >
                Open Firestore Database Settings
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          )}

          {this.state.details && (
            <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 font-mono text-[11px] text-slate-600 break-words dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              {this.state.details}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={this.state.signingOut}
              onClick={() => void this.handleSignOutRecovery()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              {this.state.signingOut ? 'Signing out...' : 'Sign Out'}
            </button>
            <button
              type="button"
              disabled={this.state.signingOut}
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reload AviaLog
            </button>
          </div>
        </div>
      </div>
    );
  }
}
