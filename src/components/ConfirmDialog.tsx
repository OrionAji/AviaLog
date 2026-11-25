import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {variant === 'danger' && (
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700 dark:bg-red-950/70 dark:text-red-300">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
            )}
            <div>
              <h3
                id="confirm-dialog-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close confirmation dialog"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {details && details.length > 0 && (
          <ul className="mt-4 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
            {details.map((item, idx) => (
              <li key={idx} className="font-mono">
                {item}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 whitespace-nowrap shrink-0 ${
              variant === 'danger'
                ? 'bg-red-700 hover:bg-red-800 focus-visible:outline-red-700'
                : 'bg-blue-700 hover:bg-blue-800 focus-visible:outline-blue-700'
            }`}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
