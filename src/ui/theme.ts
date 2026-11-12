/** Viewer's theme choice, kept in this browser. 'system' follows the operating system. */
export type Theme = 'system' | 'light' | 'dark';
const KEY = 'theme';

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* convenience only */ }
}
