import { env } from "./env.js";
import type { SupportedLanguage } from "./i18n.js";

// Renders the pinned group launch/status message. Per spec §15.
//
// Three states:
//   - "registration"  → tournament accepting players
//   - "live"          → tournament under way
//   - "ended"         → most recent tournament finished
//   - "idle"          → no recent tournament (only shown right after /setup)
//
// Output is HTML (simpler to escape than MarkdownV2) plus an inline keyboard
// with a single URL button pointing to the Mini App launch link. Web App
// buttons are private-chat-only, so a t.me URL button is the correct choice
// in a group pin.

export interface PinPlayerName {
  firstName: string;
  lastName?: string;
}

export interface PinTopTeam {
  players: PinPlayerName[];
  wins: number;
}

export type PinState =
  | { kind: "idle" }
  | {
      kind: "registration";
      registeredCount: number;
      bbqCount: number;
      teamsFormed: number;
      teamsExpected: number;
    }
  | {
      kind: "review";
      registeredCount: number;
      teamsFormed: number;
      teamsConfirmed: number;
      courtsAssigned: boolean;
    }
  | {
      kind: "live";
      matchesPlayed: number;
      matchesTotal: number;
      leader: PinTopTeam | null;
    }
  | {
      kind: "ended";
      podium: PinTopTeam[]; // up to 3 entries, ordered 1st → 3rd
    };

export interface PinnedMessageContext {
  language: SupportedLanguage;
  groupShortId: string;
  state: PinState;
}

export interface PinnedRendered {
  text: string;
  parse_mode: "HTML";
  reply_markup: {
    inline_keyboard: Array<Array<{ text: string; url: string }>>;
  };
}

function launchUrl(groupShortId: string): string {
  return `https://t.me/${env.telegramBotUsername}/${env.miniAppShortName}?startapp=g_${groupShortId}`;
}

const STRINGS: Record<
  SupportedLanguage,
  {
    openButton: string;
    statusIdle: string;
    statusIdleHint: string;
    statusRegistration: string;
    statusReview: string;
    statusLive: string;
    statusEnded: string;
    registeredLabel: string;
    bbqLabel: string;
    pairsLabel: (formed: number, expected: number) => string;
    confirmedLabel: (confirmed: number, formed: number) => string;
    courtsAssignedYes: string;
    courtsAssignedNo: string;
    matchesLabel: (played: number, total: number) => string;
    leaderLabel: (team: string, wins: number) => string;
    noLeader: string;
  }
> = {
  en: {
    openButton: "🎾 Open the app",
    statusIdle: "🟢 Ready for next tournament",
    statusIdleHint: "Tap below to register when one opens.",
    statusRegistration: "🟢 Registration is open",
    statusReview: "🟡 Setting up — admin finalising teams",
    statusLive: "🔴 Tournament in progress",
    statusEnded: "🏁 Tournament ended",
    registeredLabel: "Registered",
    bbqLabel: "BBQ",
    pairsLabel: (f, e) => `Pairs formed: <b>${f}</b> of <b>${e}</b>`,
    confirmedLabel: (c, f) => `Confirmed: <b>${c}</b> of <b>${f}</b>`,
    courtsAssignedYes: "🏟 Courts assigned",
    courtsAssignedNo: "🏟 Courts not assigned yet",
    matchesLabel: (p, t) => `Matches played: <b>${p}</b> of <b>${t}</b>`,
    leaderLabel: (team, wins) =>
      `🏅 Leader: <b>${team}</b> · ${wins} ${wins === 1 ? "win" : "wins"}`,
    noLeader: "🏅 No matches played yet",
  },
  es: {
    openButton: "🎾 Abrir la app",
    statusIdle: "🟢 Listos para el próximo torneo",
    statusIdleHint: "Toca abajo para inscribirte cuando se abra uno.",
    statusRegistration: "🟢 Inscripciones abiertas",
    statusReview: "🟡 Preparativos — el admin finaliza los equipos",
    statusLive: "🔴 Torneo en curso",
    statusEnded: "🏁 Torneo finalizado",
    registeredLabel: "Inscritos",
    bbqLabel: "BBQ",
    pairsLabel: (f, e) => `Parejas formadas: <b>${f}</b> de <b>${e}</b>`,
    confirmedLabel: (c, f) => `Confirmadas: <b>${c}</b> de <b>${f}</b>`,
    courtsAssignedYes: "🏟 Pistas asignadas",
    courtsAssignedNo: "🏟 Pistas por asignar",
    matchesLabel: (p, t) => `Partidos jugados: <b>${p}</b> de <b>${t}</b>`,
    leaderLabel: (team, wins) =>
      `🏅 Líder: <b>${team}</b> · ${wins} ${wins === 1 ? "victoria" : "victorias"}`,
    noLeader: "🏅 Aún sin partidos jugados",
  },
  ru: {
    openButton: "🎾 Открыть приложение",
    statusIdle: "🟢 Готовы к следующему турниру",
    statusIdleHint:
      "Нажмите кнопку ниже, чтобы записаться, когда он откроется.",
    statusRegistration: "🟢 Регистрация открыта",
    statusReview: "🟡 Подготовка — админ завершает формирование команд",
    statusLive: "🔴 Турнир идёт",
    statusEnded: "🏁 Турнир завершён",
    registeredLabel: "Зарегистрировано",
    bbqLabel: "BBQ",
    pairsLabel: (f, e) => `Пар собрано: <b>${f}</b> из <b>${e}</b>`,
    confirmedLabel: (c, f) => `Подтверждено: <b>${c}</b> из <b>${f}</b>`,
    courtsAssignedYes: "🏟 Корты назначены",
    courtsAssignedNo: "🏟 Корты ещё не назначены",
    matchesLabel: (p, t) => `Сыграно матчей: <b>${p}</b> из <b>${t}</b>`,
    leaderLabel: (team, wins) =>
      `🏅 Лидер: <b>${team}</b> · ${wins} ${pluralRu(wins, ["победа", "победы", "побед"])}`,
    noLeader: "🏅 Ещё нет сыгранных матчей",
  },
};

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function fullName(p: PinPlayerName): string {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

function teamLabel(t: PinTopTeam): string {
  return t.players.map(fullName).join(" + ");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderPinnedMessage(ctx: PinnedMessageContext): PinnedRendered {
  const s = STRINGS[ctx.language];
  const lines: string[] = [];

  switch (ctx.state.kind) {
    case "idle":
      lines.push(`🎾 <b>${s.statusIdle}</b>`, "", s.statusIdleHint);
      break;
    case "registration": {
      const st = ctx.state;
      lines.push(
        `🎾 <b>${s.statusRegistration}</b>`,
        "",
        `👥 ${s.registeredLabel}: <b>${st.registeredCount}</b>   🍖 ${s.bbqLabel}: <b>${st.bbqCount}</b>`,
        `🤝 ${s.pairsLabel(st.teamsFormed, st.teamsExpected)}`,
      );
      break;
    }
    case "review": {
      const st = ctx.state;
      lines.push(
        `🎾 <b>${s.statusReview}</b>`,
        "",
        `👥 ${s.registeredLabel}: <b>${st.registeredCount}</b>`,
        `✅ ${s.confirmedLabel(st.teamsConfirmed, st.teamsFormed)}`,
        st.courtsAssigned ? s.courtsAssignedYes : s.courtsAssignedNo,
      );
      break;
    }
    case "live": {
      const st = ctx.state;
      lines.push(
        `🎾 <b>${s.statusLive}</b>`,
        "",
        `🏟 ${s.matchesLabel(st.matchesPlayed, st.matchesTotal)}`,
        st.leader
          ? s.leaderLabel(escapeHtml(teamLabel(st.leader)), st.leader.wins)
          : s.noLeader,
      );
      break;
    }
    case "ended": {
      const medals = ["🥇", "🥈", "🥉"];
      lines.push(`🎾 <b>${s.statusEnded}</b>`, "");
      ctx.state.podium.slice(0, 3).forEach((t, i) => {
        lines.push(`${medals[i] ?? "•"} <b>${escapeHtml(teamLabel(t))}</b>`);
      });
      break;
    }
  }

  return {
    text: lines.join("\n"),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: s.openButton, url: launchUrl(ctx.groupShortId) }],
      ],
    },
  };
}
