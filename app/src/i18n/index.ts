import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ru from "./locales/ru.json";
import {
  FALLBACK,
  resolveLocale,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "./resolveLocale";
import { storage } from "../telegram";
import { setLanguage as setApiLanguage } from "../apiClient";

const LANG_STORAGE_KEY = "lang";

export async function initI18n(): Promise<SupportedLanguage> {
  // Read user override first (if any), then resolve from Telegram/browser.
  const override = await storage.get(LANG_STORAGE_KEY);
  const lng = resolveLocale(override);

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      ru: { translation: ru },
    },
    lng,
    fallbackLng: FALLBACK,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  setApiLanguage(lng);
  return lng;
}

export async function setLanguage(lng: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(lng);
  setApiLanguage(lng);
  await storage.set(LANG_STORAGE_KEY, lng);
}

export { i18n };
