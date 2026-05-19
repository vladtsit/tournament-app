import type { InvocationContext } from "@azure/functions";
import { containers_ } from "./cosmos.js";
import type { SupportedLanguage } from "./i18n.js";
import {
  renderPinnedMessage,
  type PinPlayerName,
  type PinState,
  type PinTopTeam,
} from "./pinnedMessage.js";
import { reconcileMatches, type MatchDoc } from "./matches.js";
import { aggregateLeaderboard } from "./scoring.js";
import {
  editMessageText,
  pinChatMessage,
  sendMessage,
  TelegramApiError,
} from "./telegramApi.js";

// Single entry point that recomputes the pin's contents from current Cosmos
// state and pushes the change to Telegram. Idempotent and silent (uses
// editMessageText, which does not trigger a chat notification). Called on
// every state change — no debounce, so the pinned message is always in sync
// with the app numbers.

interface RefreshOpts {
  /** Re-pin the message after editing/sending (idempotent — used by /setup to
   *  recover from an admin manually unpinning the launch message). */
  pin?: boolean;
}

interface GroupDoc {
  id: string;
  groupId: string;
  groupShortId: string;
  telegramChatId: number;
  title: string;
  settings: {
    language: SupportedLanguage;
  };
  botRights?: { canPinMessages?: boolean };
  pinnedMessageId?: number;
}

interface TournamentDoc {
  id: string;
  groupId: string;
  status: "draft" | "registration_open" | "live" | "ended";
  endedAt?: string;
  finalStandings?: Array<{
    rank: number;
    teamId: string;
    matches: number;
    wins: number;
    losses: number;
  }>;
}

interface TeamDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  players: PinPlayerName[];
  status?: "active" | "disbanded";
}

export type RefreshOutcome =
  | "updated"
  | "resent"
  | "no_change"
  | "no_group"
  | "error";

export async function refreshPinnedMessage(
  groupId: string,
  opts: RefreshOpts = {},
  ctx?: InvocationContext,
): Promise<RefreshOutcome> {
  try {
    const groupRead = await containers_
      .groups()
      .item(groupId, groupId)
      .read<GroupDoc>()
      .catch(() => null);
    const group = groupRead?.resource;
    if (!group) return "no_group";

    const state = await computePinState(group);
    const rendered = renderPinnedMessage({
      language: group.settings.language,
      groupShortId: group.groupShortId,
      groupTitle: group.title,
      state,
    });

    let outcome: RefreshOutcome = "no_change";
    let newMessageId: number | undefined;

    if (group.pinnedMessageId) {
      try {
        await editMessageText({
          chat_id: group.telegramChatId,
          message_id: group.pinnedMessageId,
          text: rendered.text,
          parse_mode: rendered.parse_mode,
          reply_markup: rendered.reply_markup,
        });
        outcome = "updated";
      } catch (err) {
        if (
          err instanceof TelegramApiError &&
          err.description.includes("message is not modified")
        ) {
          outcome = "no_change";
        } else if (
          err instanceof TelegramApiError &&
          (err.description.includes("message to edit not found") ||
            err.description.includes("MESSAGE_ID_INVALID"))
        ) {
          // Pinned message was deleted — re-send (silently, do NOT re-pin to
          // avoid notification spam; next /setup will repin).
          const sent = await sendMessage({
            chat_id: group.telegramChatId,
            text: rendered.text,
            parse_mode: rendered.parse_mode,
            reply_markup: rendered.reply_markup,
            disable_notification: true,
          });
          newMessageId = sent.message_id;
          if (opts.pin && group.botRights?.canPinMessages) {
            await pinChatMessage({
              chat_id: group.telegramChatId,
              message_id: sent.message_id,
              disable_notification: true,
            }).catch((e) => ctx?.warn?.("pinChatMessage failed", e));
          }
          outcome = "resent";
        } else {
          ctx?.warn?.("editMessageText failed", err);
          return "error";
        }
      }
      // If caller asked for a guaranteed pin (e.g. /setup), re-pin the
      // existing message in case an admin unpinned it. pinChatMessage is
      // idempotent — it returns ok=true even when the message is already
      // pinned — so this is safe to call unconditionally.
      if (opts.pin && group.botRights?.canPinMessages) {
        const messageId = newMessageId ?? group.pinnedMessageId;
        if (messageId !== undefined) {
          await pinChatMessage({
            chat_id: group.telegramChatId,
            message_id: messageId,
            disable_notification: true,
          }).catch((e) => ctx?.warn?.("pinChatMessage (repin) failed", e));
        }
      }
    } else {
      // No existing pin (post-/setup creation path). Send + pin.
      const sent = await sendMessage({
        chat_id: group.telegramChatId,
        text: rendered.text,
        parse_mode: rendered.parse_mode,
        reply_markup: rendered.reply_markup,
      });
      newMessageId = sent.message_id;
      if (group.botRights?.canPinMessages) {
        await pinChatMessage({
          chat_id: group.telegramChatId,
          message_id: sent.message_id,
          disable_notification: true,
        }).catch((e) => ctx?.warn?.("pinChatMessage failed", e));
      }
      outcome = "resent";
    }

    // Persist a new message id when we had to re-send. No bookkeeping
    // otherwise — we removed the debounce so there's no lastPinUpdateAt to
    // track.
    if (newMessageId !== undefined) {
      const updated: GroupDoc = {
        ...group,
        pinnedMessageId: newMessageId,
      };
      await containers_.groups().items.upsert(updated);
    }

    return outcome;
  } catch (err) {
    ctx?.warn?.("refreshPinnedMessage failed", err);
    return "error";
  }
}

async function computePinState(group: GroupDoc): Promise<PinState> {
  // Latest non-ended tournament wins.
  const currentQ = await containers_
    .tournaments()
    .items.query<TournamentDoc>(
      {
        query:
          "SELECT TOP 1 * FROM c WHERE c.groupId = @g AND c.status IN ('draft','registration_open','live') ORDER BY c.createdAt DESC",
        parameters: [{ name: "@g", value: group.groupId }],
      },
      { partitionKey: group.groupId },
    )
    .fetchAll();
  const current = currentQ.resources[0];

  if (current) {
    if (current.status === "live") {
      return await liveState(group.groupId, current.id);
    }
    return await registrationState(group.groupId, current.id);
  }

  // Otherwise the most recent ended tournament becomes the "ended" pin
  // (no time limit — keep the podium up until next setup/create).
  const endedQ = await containers_
    .tournaments()
    .items.query<TournamentDoc>(
      {
        query:
          "SELECT TOP 1 * FROM c WHERE c.groupId = @g AND c.status = 'ended' ORDER BY c.endedAt DESC",
        parameters: [{ name: "@g", value: group.groupId }],
      },
      { partitionKey: group.groupId },
    )
    .fetchAll();
  const ended = endedQ.resources[0];
  if (ended) {
    return await endedState(group.groupId, ended);
  }

  return { kind: "idle" };
}

async function registrationState(
  groupId: string,
  tournamentId: string,
): Promise<PinState> {
  const [counts, teamsQ] = await Promise.all([
    containers_
      .registrations()
      .items.query<{ playing: number; bbq: number }>(
        {
          query:
            "SELECT VALUE { playing: SUM(c.playing ? 1 : 0), bbq: SUM(c.bbq ? 1 : 0) } FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
          parameters: [
            { name: "@g", value: groupId },
            { name: "@t", value: tournamentId },
          ],
        },
        { partitionKey: groupId },
      )
      .fetchAll(),
    containers_
      .teams()
      .items.query<{ n: number }>(
        {
          query:
            "SELECT VALUE COUNT(1) FROM c WHERE c.groupId = @g AND c.tournamentId = @t AND (NOT IS_DEFINED(c.status) OR c.status = 'active')",
          parameters: [
            { name: "@g", value: groupId },
            { name: "@t", value: tournamentId },
          ],
        },
        { partitionKey: groupId },
      )
      .fetchAll(),
  ]);
  const c = counts.resources[0] ?? { playing: 0, bbq: 0 };
  const teamsFormed = (teamsQ.resources[0] as unknown as number) ?? 0;
  const teamsExpected = Math.floor(c.playing / 2);
  return {
    kind: "registration",
    registeredCount: c.playing,
    bbqCount: c.bbq,
    teamsFormed,
    teamsExpected,
  };
}

async function liveState(
  groupId: string,
  tournamentId: string,
): Promise<PinState> {
  const [teamsQ, matchesQ] = await Promise.all([
    containers_
      .teams()
      .items.query<TeamDoc>(
        {
          query: "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
          parameters: [
            { name: "@g", value: groupId },
            { name: "@t", value: tournamentId },
          ],
        },
        { partitionKey: groupId },
      )
      .fetchAll(),
    containers_
      .matches()
      .items.query<MatchDoc>(
        {
          query: "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
          parameters: [
            { name: "@g", value: groupId },
            { name: "@t", value: tournamentId },
          ],
        },
        { partitionKey: groupId },
      )
      .fetchAll(),
  ]);
  const teams = teamsQ.resources;
  const reconciled = await reconcileMatches(matchesQ.resources);
  const teamCount = teams.length;
  const matchesTotal = (teamCount * (teamCount - 1)) / 2;

  const { ranked, needsMore } = aggregateLeaderboard(
    teams.map((t) => t.id),
    reconciled.map((m) => ({
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      setsA: m.setsA,
      setsB: m.setsB,
      gamesA: m.gamesA,
      gamesB: m.gamesB,
      winner: m.winner,
    })),
    0, // ignore minMatchesForRanking — we just want a sorted list
  );
  const top = ranked[0] ?? needsMore[0];
  let leader: PinTopTeam | null = null;
  if (top && top.matches > 0) {
    const team = teams.find((tt) => tt.id === top.teamId);
    if (team) {
      leader = {
        players: team.players.map((p) => ({
          firstName: p.firstName,
          ...(p.lastName ? { lastName: p.lastName } : {}),
        })),
        wins: top.wins,
      };
    }
  }
  return {
    kind: "live",
    matchesPlayed: reconciled.length,
    matchesTotal,
    leader,
  };
}

async function endedState(
  groupId: string,
  tournament: TournamentDoc,
): Promise<PinState> {
  if (!tournament.finalStandings || tournament.finalStandings.length === 0) {
    return { kind: "ended", podium: [] };
  }
  const top3 = tournament.finalStandings
    .filter((s) => s.rank <= 3)
    .sort((a, b) => a.rank - b.rank);
  const teamsQ = await containers_
    .teams()
    .items.query<TeamDoc>(
      {
        query: "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
        parameters: [
          { name: "@g", value: groupId },
          { name: "@t", value: tournament.id },
        ],
      },
      { partitionKey: groupId },
    )
    .fetchAll();
  const byId = new Map(teamsQ.resources.map((t) => [t.id, t]));
  const podium: PinTopTeam[] = top3.map((s) => {
    const team = byId.get(s.teamId);
    return {
      players:
        team?.players.map((p) => ({
          firstName: p.firstName,
          ...(p.lastName ? { lastName: p.lastName } : {}),
        })) ?? [],
      wins: s.wins,
    };
  });
  return { kind: "ended", podium };
}
