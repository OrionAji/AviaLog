import React from 'react';
import { Moon, Sun } from 'lucide-react';
import type { ThemeMode } from '../utils/theme';

interface ThemeToggleProps {
  theme: ThemeMode;
  onToggle: () => void;
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  theme,
  onToggle,
  compact = false,
}) => {
  const isDark = theme === 'dark';
  const nextLabel = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={nextLabel}
      aria-pressed={isDark}
      title={nextLabel}
      data-testid="theme-toggle"
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white whitespace-nowrap shrink-0"
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4 text-slate-600 shrink-0" aria-hidden="true" />
      )}
      {!compact && <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  );
};
