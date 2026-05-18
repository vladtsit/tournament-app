// Tiny server-side language code normaliser + bot message translator.

export const SUPPORTED_LANGUAGES = ["en", "es", "ru"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function resolveLanguage(
  code: string | undefined | null,
): SupportedLanguage {
  if (!code) return "en";
  const primary = code.toLowerCase().split("-")[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary as string)
    ? (primary as SupportedLanguage)
    : "en";
}

// Bot-side strings. Kept inline (small surface area, no JSON loading from
// compiled Functions output).
type BotKey =
  | "setup.notAdmin"
  | "setup.notGroup"
  | "setup.botMissingPinRight"
  | "setup.success"
  | "setup.alreadySetUp"
  | "setup.error";

const BOT_STRINGS: Record<SupportedLanguage, Record<BotKey, string>> = {
  en: {
    "setup.notAdmin": "Only group admins can run /setup.",
    "setup.notGroup": "/setup must be run inside a group chat.",
    "setup.botMissingPinRight":
      "Please promote me with permission to pin messages, then run /setup again.",
    "setup.success": "Group registered. The launch message is pinned above.",
    "setup.alreadySetUp":
      "This group is already set up. The launch message is pinned above.",
    "setup.error": "Setup failed. Please try again.",
  },
  es: {
    "setup.notAdmin":
      "Solo los administradores del grupo pueden ejecutar /setup.",
    "setup.notGroup": "/setup debe ejecutarse dentro de un grupo.",
    "setup.botMissingPinRight":
      "Concédeme permiso para fijar mensajes y vuelve a ejecutar /setup.",
    "setup.success":
      "Grupo registrado. El mensaje de inicio está fijado arriba.",
    "setup.alreadySetUp":
      "Este grupo ya está configurado. El mensaje de inicio está fijado arriba.",
    "setup.error": "Error al configurar. Inténtalo de nuevo.",
  },
  ru: {
    "setup.notAdmin": "Запускать /setup могут только администраторы группы.",
    "setup.notGroup": "/setup нужно запускать в групповом чате.",
    "setup.botMissingPinRight":
      "Выдайте мне право закреплять сообщения и запустите /setup снова.",
    "setup.success":
      "Группа зарегистрирована. Сообщение запуска закреплено выше.",
    "setup.alreadySetUp":
      "Эта группа уже настроена. Сообщение запуска закреплено выше.",
    "setup.error": "Не удалось настроить. Попробуйте ещё раз.",
  },
};

export function t(lang: SupportedLanguage, key: BotKey): string {
  return BOT_STRINGS[lang][key] ?? BOT_STRINGS.en[key] ?? key;
}
