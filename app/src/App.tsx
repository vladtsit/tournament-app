import { useTranslation } from 'react-i18next';
import { useTelegramAuth } from './hooks/useTelegramAuth';
import { setLanguage } from './i18n';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n/resolveLocale';

export function App(): JSX.Element {
  const { t, i18n } = useTranslation();
  const auth = useTelegramAuth();

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        padding: 16,
        maxWidth: 480,
        margin: '0 auto',
        color: 'var(--tg-theme-text-color, inherit)',
        background: 'var(--tg-theme-bg-color, transparent)',
        minHeight: '100vh',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>{t('app.title')}</h1>
        <LanguagePicker current={i18n.language as SupportedLanguage} />
      </header>

      <section style={{ marginTop: 24 }}>
        {auth.status === 'idle' && <p>…</p>}
        {auth.status === 'authenticating' && <p>{t('app.authenticating')}</p>}
        {auth.status === 'not_in_telegram' && <p>{t('app.openFromTelegram')}</p>}
        {auth.status === 'error' && (
          <p>
            {t(`errors.${auth.errorCode ?? 'errorGeneric'}` as const, {
              defaultValue: t('app.errorGeneric'),
            })}
          </p>
        )}
        {auth.status === 'authenticated' && auth.user && (
          <p>{t('auth.welcome', { name: auth.user.firstName })}</p>
        )}
      </section>
    </main>
  );
}

function LanguagePicker({ current }: { current: SupportedLanguage }): JSX.Element {
  const { t } = useTranslation();
  const labels: Record<SupportedLanguage, string> = {
    en: t('common.english'),
    es: t('common.spanish'),
    ru: t('common.russian'),
  };
  return (
    <label style={{ fontSize: 12, opacity: 0.8 }}>
      <span style={{ marginRight: 4 }}>{t('common.language')}:</span>
      <select
        value={current}
        onChange={(e) => {
          void setLanguage(e.target.value as SupportedLanguage);
        }}
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {labels[lng]}
          </option>
        ))}
      </select>
    </label>
  );
}
