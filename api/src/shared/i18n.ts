// Tiny server-side language code normaliser. Server-side i18n bundles are
// added when the bot starts sending Telegram messages (Phase 1).

export const SUPPORTED_LANGUAGES = ['en', 'es', 'ru'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function resolveLanguage(code: string | undefined | null): SupportedLanguage {
  if (!code) return 'en';
  const primary = code.toLowerCase().split('-')[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary as string)
    ? (primary as SupportedLanguage)
    : 'en';
}
