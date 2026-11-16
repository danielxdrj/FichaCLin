export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'fichaclin-theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* armazenamento indisponível */
  }
  return 'system';
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignora */
  }
  applyTheme(pref);
}
