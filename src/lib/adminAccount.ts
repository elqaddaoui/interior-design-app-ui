/** Pure helpers of the administrator account page (no React, easy to test). */

export type Strength = 0 | 1 | 2 | 3; // 0 = empty, 1 = weak, 2 = ok, 3 = strong

/** Same floor as the server (8+ characters, not a well-known password) plus a letter and a digit; "strong" adds length/variety. */
export function passwordStrength(value: string): Strength {
  if (!value) return 0;
  const common = ['admin', 'administrator', 'password', 'password1', '12345678', '123456789', 'qwertyui', 'azertyui', 'dwira123', 'admin123', 'admin1234', 'motdepasse'];
  if (value.length < 8 || common.includes(value.toLowerCase()) || /^(.)\1+$/.test(value)) return 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 1;
  return value.length >= 12 && classes >= 3 ? 3 : classes >= 3 || value.length >= 10 ? 3 : 2;
}
export const passwordAcceptable = (value: string) => passwordStrength(value) >= 2;

/** "3 min ago" as a translation key + number, so the page can translate it. */
export function agoParts(at: number | null | undefined, now = Date.now()): { key: 'never' | 'now' | 'min' | 'hour' | 'day'; n: number } {
  if (!at) return { key: 'never', n: 0 };
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 1) return { key: 'now', n: 0 };
  if (minutes < 60) return { key: 'min', n: minutes };
  if (minutes < 1440) return { key: 'hour', n: Math.floor(minutes / 60) };
  return { key: 'day', n: Math.floor(minutes / 1440) };
}

/** A readable device name from a user-agent string ("Chrome · Windows"). */
export function deviceName(ua?: string): string {
  const s = ua || '';
  if (!s) return '';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /okhttp|Expo|Dwira/i.test(s) ? 'App' : '';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ') || s.slice(0, 40);
}

/** Server error code → translation key of the account namespace. */
export function accountErrorKey(code: string | undefined): string {
  switch (code) {
    case 'INVALID_EMAIL': return 'ac.errEmail';
    case 'EMAIL_TAKEN': return 'ac.errEmailTaken';
    case 'INVALID_PHONE': return 'ac.errPhone';
    case 'INVALID_PROFILE': return 'ac.errName';
    case 'INVALID_CREDITS': return 'ac.errCredits';
    case 'WRONG_PASSWORD': return 'ac.errWrong';
    case 'SAME_PASSWORD': return 'ac.errSame';
    case 'WEAK_PASSWORD': return 'ac.errWeak';
    default: return 'ac.saveFailed';
  }
}

export const initialsOf = (name: string, fallback = 'A') => name.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase() || fallback;
