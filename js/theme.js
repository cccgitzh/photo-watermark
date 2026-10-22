/**
 * theme.js — 主题切换（浅色 / 深色 / 跟随系统）
 *
 * 首屏由 theme-init.js 同步应用，避免闪白；这里负责运行期切换与系统偏好联动。
 */

const STORAGE_KEY = 'pw-theme';
const media = window.matchMedia?.('(prefers-color-scheme: dark)');

export function getThemeMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(mode = getThemeMode()) {
  if (mode === 'light' || mode === 'dark') return mode;
  return media?.matches ? 'dark' : 'light';
}

export function applyTheme(mode = getThemeMode()) {
  const theme = resolveTheme(mode);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themeMode = mode;
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  meta?.setAttribute('content', theme === 'dark' ? '#0e1014' : '#f6f7f9');
  return theme;
}

export function setThemeMode(mode) {
  try {
    if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
  return applyTheme(mode);
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  return setThemeMode(next);
}

export function initTheme() {
  applyTheme();
  media?.addEventListener?.('change', () => {
    if (getThemeMode() === 'system') applyTheme('system');
  });
}
