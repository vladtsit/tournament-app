import { getWebApp } from '../telegram';

export const SUPPORTED_LANGUAGES = ['en', 'es', 'ru'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const FALLBACK: SupportedLanguage = 'en';

function normalise(code: string | undefined | null): SupportedLanguage | undefined {
  if (!code) return undefined;
  const primary = code.toLowerCase().split('-')[0] ?? '';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary)
    ? (primary as SupportedLanguage)
    : undefined;
}

/**
 * Resolve the initial UI language.
 *
 * Order: explicit override (caller passes from CloudStorage) → Telegram
 *        `language_code` → `navigator.language` → fallback.
 */
export function resolveLocale(override?: string | null): SupportedLanguage {
  const fromOverride = normalise(override);
  if (fromOverride) return fromOverride;
  const tg = getWebApp();
  const fromTelegram = normalise(tg?.initDataUnsafe?.user?.language_code);
  if (fromTelegram) return fromTelegram;
  const fromBrowser = normalise(typeof navigator !== 'undefined' ? navigator.language : undefined);
  if (fromBrowser) return fromBrowser;
  return FALLBACK;
}
