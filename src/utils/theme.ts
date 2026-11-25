export type ThemeMode = 'light' | 'dark';

export const VALID_THEMES: readonly ThemeMode[] = ['light', 'dark'] as const;

export function sanitizeThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

export function toggleThemeMode(current: ThemeMode): ThemeMode {
  return current === 'dark' ? 'light' : 'dark';
}

export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
}
