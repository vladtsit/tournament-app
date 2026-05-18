import { env } from "./env.js";
import type { SupportedLanguage } from "./i18n.js";

// Renders the pinned group launch message. Phase 1 (registration phase).
// Per spec §15. Live-phase variant added in Phase 3.

export interface PinnedMessageContext {
  language: SupportedLanguage;
  groupShortId: string;
  groupTitle: string;
  registeredCount?: number;
  bbqCount?: number;
}

function launchUrl(groupShortId: string): string {
  // Telegram requires the t.me/<bot>/<short_name>?startapp=<param> format.
  return `https://t.me/${env.telegramBotUsername}/${env.miniAppShortName}?startapp=g_${groupShortId}`;
}

const TEMPLATES: Record<
  SupportedLanguage,
  (c: PinnedMessageContext) => string
> = {
  en: (c) =>
    [
      `🎾 *Sunday Pádel — ${escapeMd(c.groupTitle)}*`,
      ``,
      `Registration is open\\.`,
      c.registeredCount !== undefined
        ? `Registered players: *${c.registeredCount}*${c.bbqCount !== undefined ? `  \\|  BBQ: *${c.bbqCount}*` : ""}`
        : `Tap the link below to register, find a teammate, and submit match results\\.`,
      ``,
      `[Open the app](${launchUrl(c.groupShortId)})`,
    ].join("\n"),
  es: (c) =>
    [
      `🎾 *Pádel del domingo — ${escapeMd(c.groupTitle)}*`,
      ``,
      `Las inscripciones están abiertas\\.`,
      c.registeredCount !== undefined
        ? `Jugadores inscritos: *${c.registeredCount}*${c.bbqCount !== undefined ? `  \\|  BBQ: *${c.bbqCount}*` : ""}`
        : `Toca el enlace para inscribirte, buscar compañero/a y registrar resultados\\.`,
      ``,
      `[Abrir la app](${launchUrl(c.groupShortId)})`,
    ].join("\n"),
  ru: (c) =>
    [
      `🎾 *Воскресный падел — ${escapeMd(c.groupTitle)}*`,
      ``,
      `Регистрация открыта\\.`,
      c.registeredCount !== undefined
        ? `Зарегистрировано игроков: *${c.registeredCount}*${c.bbqCount !== undefined ? `  \\|  BBQ: *${c.bbqCount}*` : ""}`
        : `Нажмите на ссылку, чтобы зарегистрироваться, найти напарника и вносить результаты\\.`,
      ``,
      `[Открыть приложение](${launchUrl(c.groupShortId)})`,
    ].join("\n"),
};

export function renderPinnedMessage(ctx: PinnedMessageContext): {
  text: string;
  parse_mode: "MarkdownV2";
} {
  return {
    text: TEMPLATES[ctx.language](ctx),
    parse_mode: "MarkdownV2",
  };
}

// MarkdownV2 requires escaping these characters.
// https://core.telegram.org/bots/api#markdownv2-style
function escapeMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);
}
