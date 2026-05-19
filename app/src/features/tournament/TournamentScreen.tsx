import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Crown,
  Edit3,
  Flag,
  Flame,
  RefreshCw,
  Star,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  Utensils,
} from "lucide-react";
import { api, ApiClientError, downloadAuthed } from "../../apiClient";
import { haptic, isInTelegram, storage } from "../../telegram";
import { useMainButton } from "../../hooks/useMainButton";
import { DisputesScreen } from "../admin/DisputesScreen";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Inline,
  ListRow,
  SectionTitle,
  SetScoreInput,
  Spinner,
  Stack,
  ToggleChip,
} from "../../ui";

interface PlayerSummary {
  userId: string;
  firstName: string;
  lastName?: string;
}

interface RegistrationDoc {
  userId: string;
  firstName: string;
  lastName?: string;
  playing: boolean;
  bbq: boolean;
}

interface TeamDoc {
  id: string;
  players: PlayerSummary[];
}

interface TournamentDoc {
  id: string;
  name: string;
  status: "draft" | "registration_open" | "live" | "ended";
}

interface CurrentResponse {
  tournament: TournamentDoc | null;
  registration: RegistrationDoc | null;
  team: TeamDoc | null;
  counts: { playing: number; bbq: number };
}

interface LookingResponse {
  players: Array<{
    userId: string;
    firstName: string;
    lastName?: string;
    isSelf: boolean;
  }>;
}

function fullName(p: { firstName: string; lastName?: string }): string {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

type StatusBadgeVariant = "success" | "info" | "neutral" | "warning";

function statusVariant(s: TournamentDoc["status"]): StatusBadgeVariant {
  switch (s) {
    case "live":
      return "success";
    case "registration_open":
      return "info";
    case "ended":
      return "neutral";
    default:
      return "warning";
  }
}

interface Props {
  isAdmin: boolean;
  groupId: string;
}

export function TournamentScreen({ isAdmin, groupId }: Props): JSX.Element {
  const { t } = useTranslation();
  const [data, setData] = useState<CurrentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftName, setDraftName] = useState("");
  const draftNameRef = useRef("");
  useEffect(() => {
    draftNameRef.current = draftName;
  }, [draftName]);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<CurrentResponse>("/api/tournaments/current");
      setData(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setLoading(false);
    }
  }, []);

  // Background refresh without toggling the page spinner. Animates the refresh
  // icon so the user can tell a fetch is in flight.
  const silentReload = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const res = await api<CurrentResponse>("/api/tournaments/current");
      setData(res);
    } catch {
      // ignore — keep last good state
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Auto-refresh while waiting for a partner / count changes.
  const tournamentForPoll = data?.tournament ?? null;
  const shouldPoll =
    !!tournamentForPoll &&
    tournamentForPoll.status === "registration_open" &&
    data?.registration?.playing === true &&
    !data?.team;
  useEffect(() => {
    if (!shouldPoll) return;
    const id = window.setInterval(() => {
      void silentReload();
    }, 15000);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void silentReload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [shouldPoll, silentReload]);

  const createTournament = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const name = draftNameRef.current.trim();
      await api("/api/tournaments", {
        method: "POST",
        body: name ? { name } : {},
      });
      setDraftName("");
      haptic.notify("success");
      await reload();
    } catch (err) {
      haptic.notify("error");
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const upsertRegistration = useCallback(
    async (playing: boolean, bbq: boolean): Promise<void> => {
      if (!data?.tournament) return;
      setBusy(true);
      setError(null);
      try {
        await api(`/api/tournaments/${data.tournament.id}/registrations`, {
          method: "POST",
          body: { playing, bbq },
          idempotencyKey: `reg-${data.tournament.id}-${Date.now()}`,
        });
        haptic.selection();
        await reload();
      } catch (err) {
        haptic.notify("error");
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [data, reload],
  );

  const startTournament = useCallback(async (): Promise<void> => {
    if (!data?.tournament) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tournaments/${data.tournament.id}/start`, {
        method: "POST",
        body: {},
      });
      haptic.notify("success");
      await reload();
    } catch (err) {
      haptic.notify("error");
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setBusy(false);
    }
  }, [data, reload]);

  const endTournament = useCallback(async (): Promise<void> => {
    if (!data?.tournament) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("tournament.endConfirm"))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tournaments/${data.tournament.id}/end`, {
        method: "POST",
        body: {},
      });
      haptic.notify("success");
      await reload();
    } catch (err) {
      haptic.notify("error");
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setBusy(false);
    }
  }, [data, reload, t]);

  // MainButton coordinator — unchanged from prior fix.
  const tournament = data?.tournament ?? null;
  const inTelegram = isInTelegram();
  const canCreate = !tournament && isAdmin && draftName.trim().length > 0;
  const canStart =
    !!tournament && isAdmin && tournament.status === "registration_open";
  const canEnd =
    !!tournament && isAdmin && tournament.status === "live" && !data?.team;

  const mbVisible = inTelegram && !loading && (canCreate || canStart || canEnd);
  const mbText = canCreate
    ? t("tournament.create")
    : canStart
      ? t("tournament.start")
      : canEnd
        ? t("tournament.end")
        : "";
  const mbOnClick = useCallback((): void => {
    if (canCreate) void createTournament();
    else if (canStart) void startTournament();
    else if (canEnd) void endTournament();
  }, [
    canCreate,
    canStart,
    canEnd,
    createTournament,
    startTournament,
    endTournament,
  ]);

  useMainButton({
    visible: mbVisible,
    text: mbText,
    enabled: !busy,
    showProgress: busy,
    onClick: mbOnClick,
  });

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "var(--space-7) 0",
        }}
      >
        <Spinner size={28} label={t("app.authenticating")} />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <Stack gap="sm" align="center">
          <AlertTriangle color="var(--danger)" size={28} />
          <p style={{ color: "var(--danger)", textAlign: "center" }}>
            {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void reload()}>
            {t("common.retry")}
          </Button>
        </Stack>
      </Card>
    );
  }

  if (!data?.tournament) {
    return (
      <Card variant="hero">
        <Stack gap="md" align="center">
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: "var(--radius-pill)",
              background: "var(--accent-soft)",
              color: "var(--accent)",
            }}
          >
            <Trophy size={32} />
          </span>
          <h2
            style={{
              fontSize: "var(--font-xl)",
              fontWeight: "var(--weight-bold)",
              textAlign: "center",
            }}
          >
            {t("tournament.none")}
          </h2>
          {isAdmin ? (
            <Stack gap="sm" style={{ width: "100%" }}>
              <label
                htmlFor="tournament-name"
                style={{
                  fontSize: "var(--font-sm)",
                  color: "var(--text-muted)",
                }}
              >
                {t("tournament.nameLabel")}
              </label>
              <input
                id="tournament-name"
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t("tournament.namePlaceholder")}
                disabled={busy}
                maxLength={120}
                style={textInputStyle}
              />
              <Button
                onClick={() => void createTournament()}
                disabled={busy || draftName.trim().length === 0}
                loading={busy}
                fullWidth
                size="lg"
                leftIcon={<Trophy size={18} />}
                style={{ display: inTelegram ? "none" : undefined }}
              >
                {t("tournament.create")}
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </Card>
    );
  }

  const reg = data.registration;
  const playing = reg?.playing === true;
  const bbq = reg?.bbq === true;
  const status = data.tournament.status;
  const isLive = status === "live";

  return (
    <Stack gap="md">
      {/* ─── 3a. Hero status header ─────────────────────────────────────── */}
      <Card variant="hero">
        <Stack gap="sm">
          <Inline justify="space-between" align="flex-start" gap="sm">
            <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
              <Inline gap="xs" wrap>
                <Badge variant={statusVariant(status)} size="sm" dot>
                  {t(`tournament.status.${status}`)}
                </Badge>
              </Inline>
              <h2
                style={{
                  fontSize: "var(--font-xl)",
                  fontWeight: "var(--weight-bold)",
                  lineHeight: 1.2,
                  wordBreak: "break-word",
                }}
              >
                {data.tournament.name}
              </h2>
            </Stack>
            <IconButton
              icon={<RefreshCw size={18} />}
              aria-label={t("common.refresh")}
              variant="flat"
              size="sm"
              spinning={refreshing}
              onClick={() => {
                haptic.selection();
                void silentReload();
              }}
            />
          </Inline>
          <Inline gap="lg" wrap>
            <MetricChip
              icon={<Users size={18} />}
              value={data.counts.playing}
              label={t("registration.playing")}
            />
            <MetricChip
              icon={<Utensils size={18} />}
              value={data.counts.bbq}
              label={t("registration.bbq")}
              tone="warning"
            />
          </Inline>
        </Stack>
      </Card>

      {/* ─── 3b. Registration toggles ───────────────────────────────────── */}
      {!isLive ? (
        <Card>
          <SectionTitle>{t("registration.title")}</SectionTitle>
          <Inline gap="sm" wrap>
            <ToggleChip
              checked={playing}
              tone="success"
              icon={<Users size={16} />}
              disabled={busy}
              onClick={() => void upsertRegistration(!playing, bbq)}
            >
              {t("registration.playing")}
            </ToggleChip>
            <ToggleChip
              checked={bbq}
              tone="warning"
              icon={<Flame size={16} />}
              disabled={busy}
              onClick={() => void upsertRegistration(playing, !bbq)}
            >
              {t("registration.bbq")}
            </ToggleChip>
          </Inline>
        </Card>
      ) : null}

      {/* ─── 3c. Team section ───────────────────────────────────────────── */}
      {!isLive && playing ? (
        <TeamSection
          tournamentId={data.tournament.id}
          groupId={groupId}
          team={data.team}
          onChange={reload}
        />
      ) : null}

      {/* Inline Start button — hidden in Telegram (MainButton handles it). */}
      {!isLive && isAdmin && status === "registration_open" ? (
        <Button
          onClick={() => void startTournament()}
          disabled={busy}
          loading={busy}
          size="lg"
          fullWidth
          leftIcon={<Flag size={18} />}
          style={{ display: inTelegram ? "none" : undefined }}
        >
          {t("tournament.start")}
        </Button>
      ) : null}

      {/* ─── 3d-3e. Live section ────────────────────────────────────────── */}
      {isLive && data.team ? (
        <LiveSection
          tournamentId={data.tournament.id}
          myTeam={data.team}
          isAdmin={isAdmin}
        />
      ) : null}
      {isLive && !data.team ? (
        <Card>
          <EmptyState icon={<Trophy size={28} />} title={t("live.notInTeam")} />
        </Card>
      ) : null}

      {/* End-tournament button — visible to admin; in Telegram hidden when MB
          surface is taken by LiveSection. */}
      {isLive && isAdmin ? (
        <Button
          variant="danger"
          onClick={() => void endTournament()}
          disabled={busy}
          loading={busy}
          fullWidth
          style={{
            display: inTelegram && !data.team ? "none" : undefined,
          }}
        >
          {t("tournament.end")}
        </Button>
      ) : null}
    </Stack>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Small metric pill used in the hero header.
 * ────────────────────────────────────────────────────────────────────────── */
function MetricChip({
  icon,
  value,
  label,
  tone = "accent",
}: {
  icon: JSX.Element;
  value: number;
  label: string;
  tone?: "accent" | "warning";
}): JSX.Element {
  const color = tone === "warning" ? "var(--warning)" : "var(--accent)";
  const bg = tone === "warning" ? "var(--warning-soft)" : "var(--accent-soft)";
  return (
    <Inline gap="sm" align="center">
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-pill)",
          background: bg,
          color,
        }}
      >
        {icon}
      </span>
      <Stack gap="none">
        <span
          style={{
            fontSize: "var(--font-xl)",
            fontWeight: "var(--weight-bold)",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontSize: "var(--font-xs)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            fontWeight: "var(--weight-semibold)",
          }}
        >
          {label}
        </span>
      </Stack>
    </Inline>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Team section
 * ────────────────────────────────────────────────────────────────────────── */
function TeamSection({
  tournamentId,
  groupId,
  team,
  onChange,
}: {
  tournamentId: string;
  groupId: string;
  team: TeamDoc | null;
  onChange: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<LookingResponse["players"]>([]);
  const [lastPartnerId, setLastPartnerId] = useState<string | null>(null);
  const [pendingPartnerId, setPendingPartnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inTelegram = isInTelegram();

  const reload = useCallback(async (): Promise<void> => {
    if (team) {
      setPlayers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [r, last] = await Promise.all([
        api<LookingResponse>(
          `/api/tournaments/${tournamentId}/looking-for-teammate`,
        ),
        storage.get(`lastPartner_${groupId}`),
      ]);
      setPlayers(r.players);
      setLastPartnerId(last);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setLoading(false);
    }
  }, [team, tournamentId, groupId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pair = useCallback(
    async (partnerUserId: string, partnerLabel: string): Promise<void> => {
      if (
        !inTelegram &&
        typeof window !== "undefined" &&
        !window.confirm(t("teams.confirmPair", { name: partnerLabel }))
      ) {
        return;
      }
      haptic.selection();
      setBusy(true);
      setError(null);
      try {
        await api(`/api/tournaments/${tournamentId}/teams`, {
          method: "POST",
          body: { partnerUserId },
          idempotencyKey: `team-${tournamentId}-${partnerUserId}-${Date.now()}`,
        });
        void storage.set(`lastPartner_${groupId}`, partnerUserId);
        setPendingPartnerId(null);
        haptic.notify("success");
        await onChange();
      } catch (err) {
        haptic.notify("error");
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [tournamentId, groupId, onChange, t, inTelegram],
  );

  const pendingPartner = pendingPartnerId
    ? (players.find((p) => p.userId === pendingPartnerId) ?? null)
    : null;
  const pendingLabel = pendingPartner ? fullName(pendingPartner) : "";

  useMainButton({
    visible: inTelegram && !team && !!pendingPartnerId && !busy,
    text: pendingLabel ? t("teams.pairWith", { name: pendingLabel }) : "",
    enabled: !busy,
    showProgress: busy,
    onClick: () => {
      if (pendingPartnerId && pendingLabel) {
        void pair(pendingPartnerId, pendingLabel);
      }
    },
  });

  const leaveTeam = useCallback(async (): Promise<void> => {
    if (!team) return;
    const teamLabel = team.players.map(fullName).join(" + ");
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("teams.leaveConfirm", { name: teamLabel }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tournaments/${tournamentId}/teams/${team.id}`, {
        method: "DELETE",
        idempotencyKey: `leave-${tournamentId}-${team.id}-${Date.now()}`,
      });
      haptic.notify("success");
      await onChange();
    } catch (err) {
      haptic.notify("error");
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setBusy(false);
    }
  }, [tournamentId, team, onChange, t]);

  const sortedCandidates = useMemo(() => {
    return players
      .filter((p) => !p.isSelf)
      .slice()
      .sort((a, b) => {
        if (lastPartnerId) {
          if (a.userId === lastPartnerId) return -1;
          if (b.userId === lastPartnerId) return 1;
        }
        return fullName(a).localeCompare(fullName(b));
      });
  }, [players, lastPartnerId]);

  return (
    <Card>
      <SectionTitle>{t("teams.title")}</SectionTitle>
      {team ? (
        <Stack gap="sm">
          <Inline gap="sm" align="center" wrap>
            {team.players.map((p) => (
              <Inline key={p.userId} gap="xs" align="center">
                <Avatar id={p.userId} name={fullName(p)} size={32} />
                <span style={{ fontWeight: "var(--weight-semibold)" }}>
                  {fullName(p)}
                </span>
              </Inline>
            ))}
          </Inline>
          <Button
            variant="danger"
            size="sm"
            onClick={() => void leaveTeam()}
            disabled={busy}
            loading={busy}
          >
            {t("teams.leave")}
          </Button>
        </Stack>
      ) : loading ? (
        <Inline justify="center" style={{ padding: "var(--space-4)" }}>
          <Spinner />
        </Inline>
      ) : sortedCandidates.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={28} />}
          title={t("teams.nooneLooking")}
        />
      ) : (
        <Stack gap="xs">
          {sortedCandidates.map((p) => {
            const recent = p.userId === lastPartnerId;
            const selected = p.userId === pendingPartnerId;
            const onRowClick = (): void => {
              if (busy) return;
              if (inTelegram) {
                haptic.selection();
                setPendingPartnerId((curr) =>
                  curr === p.userId ? null : p.userId,
                );
              } else {
                void pair(p.userId, fullName(p));
              }
            };
            return (
              <ListRow
                key={p.userId}
                interactive
                bordered
                selected={selected}
                disabled={busy}
                onClick={onRowClick}
                leading={<Avatar id={p.userId} name={fullName(p)} size={36} />}
                primary={fullName(p)}
                secondary={
                  recent ? (
                    <Inline gap="xs" align="center">
                      <Star
                        size={12}
                        fill="var(--podium-gold)"
                        color="var(--podium-gold)"
                      />
                      <span>{t("teams.lastPartner")}</span>
                    </Inline>
                  ) : null
                }
                trailing={
                  selected ? (
                    <Check size={18} color="var(--accent)" />
                  ) : (
                    <UserPlus size={18} color="var(--text-muted)" />
                  )
                }
              />
            );
          })}
        </Stack>
      )}
      {error ? (
        <p
          style={{
            color: "var(--danger)",
            fontSize: "var(--font-sm)",
            marginTop: "var(--space-2)",
          }}
        >
          {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
        </p>
      ) : null}
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Live section
 * ────────────────────────────────────────────────────────────────────────── */
interface OpponentRow {
  teamId: string;
  players: PlayerSummary[];
  matchesPlayed: number;
}

interface MatchRow {
  id: string;
  tournamentId: string;
  teamAId: string;
  teamBId: string;
  submittedByUserId: string;
  sets: Array<{ a: number; b: number }>;
  winner: "A" | "B";
  status: "submitted" | "confirmed" | "disputed";
  submittedAt: string;
  autoConfirmDueAt: string;
}

interface LeaderboardRow {
  teamId: string;
  matches: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
  gamesFor: number;
  gamesAgainst: number;
  winRate: number;
  setRatio: number;
  gameRatio: number;
  players: PlayerSummary[];
}

interface LeaderboardResponse {
  ranked: LeaderboardRow[];
  needsMore: LeaderboardRow[];
  minMatchesForRanking: number;
}

function LiveSection({
  tournamentId,
  myTeam,
  isAdmin,
}: {
  tournamentId: string;
  myTeam: TeamDoc;
  isAdmin: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const [opponents, setOpponents] = useState<OpponentRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set scores as `number | ""` so the SetScoreInput stepper integrates cleanly.
  const [s1a, setS1a] = useState<number | "">("");
  const [s1b, setS1b] = useState<number | "">("");
  const [s2a, setS2a] = useState<number | "">("");
  const [s2b, setS2b] = useState<number | "">("");
  const [s3a, setS3a] = useState<number | "">("");
  const [s3b, setS3b] = useState<number | "">("");
  const [opponentId, setOpponentId] = useState("");
  const [showDisputes, setShowDisputes] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [opp, ms, lb] = await Promise.all([
        api<{ opponents: OpponentRow[] }>(
          `/api/tournaments/${tournamentId}/available-opponents`,
        ),
        api<{ matches: MatchRow[] }>(
          `/api/tournaments/${tournamentId}/matches`,
        ),
        api<LeaderboardResponse>(
          `/api/tournaments/${tournamentId}/leaderboard`,
        ),
      ]);
      setOpponents(opp.opponents);
      setMatches(ms.matches);
      setBoard(lb);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submitMatch = useCallback(async (): Promise<void> => {
    if (!opponentId) {
      setError("missing_opponent");
      return;
    }
    const sets: Array<{ a: number; b: number }> = [];
    const triples: Array<[number | "", number | ""]> = [
      [s1a, s1b],
      [s2a, s2b],
      [s3a, s3b],
    ];
    for (const [a, b] of triples) {
      if (a === "" && b === "") continue;
      if (typeof a !== "number" || typeof b !== "number") {
        setError("invalid_set_score");
        return;
      }
      sets.push({ a, b });
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tournaments/${tournamentId}/matches`, {
        method: "POST",
        body: { opponentTeamId: opponentId, sets },
        idempotencyKey: `match-${tournamentId}-${opponentId}-${Date.now()}`,
      });
      setS1a("");
      setS1b("");
      setS2a("");
      setS2b("");
      setS3a("");
      setS3b("");
      setOpponentId("");
      haptic.notify("success");
      await reload();
    } catch (err) {
      haptic.notify("error");
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setBusy(false);
    }
  }, [tournamentId, opponentId, s1a, s1b, s2a, s2b, s3a, s3b, reload]);

  const confirmMatch = useCallback(
    async (matchId: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await api(`/api/matches/${matchId}/confirm`, {
          method: "POST",
          body: {},
        });
        haptic.notify("success");
        await reload();
      } catch (err) {
        haptic.notify("error");
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const disputeMatch = useCallback(
    async (matchId: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await api(`/api/matches/${matchId}/dispute`, {
          method: "POST",
          body: {},
        });
        haptic.notify("warning");
        await reload();
      } catch (err) {
        haptic.notify("error");
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const adminEditMatch = useCallback(
    async (m: MatchRow): Promise<void> => {
      if (typeof window === "undefined") return;
      const current = m.sets.map((s) => `${s.a}-${s.b}`).join(",");
      const raw = window.prompt(t("admin.editPrompt"), current);
      if (raw === null) return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const sets: Array<{ a: number; b: number }> = [];
      for (const part of trimmed.split(/[,\s]+/)) {
        if (!part) continue;
        const match = /^(\d+)[-:](\d+)$/.exec(part);
        if (!match) {
          setError("invalid_set_score");
          return;
        }
        sets.push({ a: Number(match[1]), b: Number(match[2]) });
      }
      if (sets.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        await api(`/api/matches/${m.id}`, {
          method: "PATCH",
          body: { sets },
        });
        haptic.notify("success");
        await reload();
      } catch (err) {
        haptic.notify("error");
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [reload, t],
  );

  const adminForceConfirm = useCallback(
    async (matchId: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await api(`/api/matches/${matchId}`, {
          method: "PATCH",
          body: { status: "confirmed" },
        });
        haptic.notify("success");
        await reload();
      } catch (err) {
        haptic.notify("error");
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const adminDeleteMatch = useCallback(
    async (m: MatchRow): Promise<void> => {
      const label = `${m.sets.map((s) => `${s.a}-${s.b}`).join(", ")}`;
      if (
        typeof window !== "undefined" &&
        !window.confirm(t("admin.deleteConfirm", { score: label }))
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await api(`/api/matches/${m.id}`, { method: "DELETE" });
        haptic.notify("success");
        await reload();
      } catch (err) {
        haptic.notify("error");
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [reload, t],
  );

  const hasAnySet =
    (s1a !== "" && s1b !== "") ||
    (s2a !== "" && s2b !== "") ||
    (s3a !== "" && s3b !== "");
  const canSubmit = !!opponentId && hasAnySet && !busy;
  const inTelegram = isInTelegram();

  useMainButton({
    visible: inTelegram && !loading && !showDisputes,
    text: t("live.submitMatch"),
    enabled: canSubmit,
    showProgress: busy,
    onClick: () => void submitMatch(),
  });

  if (loading) {
    return (
      <Inline justify="center" style={{ padding: "var(--space-5)" }}>
        <Spinner size={28} />
      </Inline>
    );
  }

  const teamLabel = (row: { players: PlayerSummary[] }): string =>
    row.players.map(fullName).join(" + ");
  const teamLabelById = (id: string): string => {
    if (id === myTeam.id) return teamLabel(myTeam);
    const fromOpp = opponents.find((o) => o.teamId === id);
    if (fromOpp) return teamLabel(fromOpp);
    const fromBoard =
      board?.ranked.find((r) => r.teamId === id) ??
      board?.needsMore.find((r) => r.teamId === id);
    if (fromBoard) return teamLabel(fromBoard);
    return id.slice(0, 6);
  };

  const disputeCount = matches.filter((m) => m.status === "disputed").length;

  return (
    <>
      {showDisputes ? (
        <DisputesScreen
          tournamentId={tournamentId}
          onClose={() => setShowDisputes(false)}
        />
      ) : null}
      <div style={{ display: showDisputes ? "none" : "contents" }}>
        {/* ─── 3f. Admin overview ─────────────────────────────────────── */}
        {isAdmin ? (
          <Card>
            <SectionTitle>{t("admin.overview")}</SectionTitle>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "var(--space-3)",
                marginBottom: "var(--space-3)",
              }}
            >
              <MetricStat
                label={t("live.col.team")}
                value={
                  (board?.ranked.length ?? 0) + (board?.needsMore.length ?? 0)
                }
              />
              <MetricStat
                label={t("live.matchStatus.confirmed")}
                value={matches.filter((m) => m.status === "confirmed").length}
                tone="success"
              />
              <MetricStat
                label={t("live.matchStatus.submitted")}
                value={matches.filter((m) => m.status === "submitted").length}
              />
              <MetricStat
                label={t("live.matchStatus.disputed")}
                value={disputeCount}
                tone={disputeCount > 0 ? "danger" : "neutral"}
              />
            </div>
            <Inline gap="sm" wrap>
              <Button
                variant={disputeCount > 0 ? "danger" : "secondary"}
                size="sm"
                leftIcon={<AlertTriangle size={16} />}
                onClick={() => {
                  haptic.selection();
                  setShowDisputes(true);
                }}
              >
                {t("admin.openDisputes", { n: disputeCount })}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void downloadAuthed(
                    `/api/tournaments/${tournamentId}/bbq-export`,
                    `bbq-${tournamentId}.csv`,
                  )
                }
              >
                {t("admin.exportBbq")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void downloadAuthed(
                    `/api/tournaments/${tournamentId}/results-export`,
                    `results-${tournamentId}.csv`,
                  )
                }
              >
                {t("admin.exportResults")}
              </Button>
            </Inline>
          </Card>
        ) : null}

        {/* ─── 3d. Match entry ────────────────────────────────────────── */}
        <Card>
          <SectionTitle>{t("live.submit")}</SectionTitle>
          <Stack gap="md">
            <div>
              <label
                style={{
                  fontSize: "var(--font-sm)",
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: "var(--space-2)",
                }}
              >
                {t("live.opponent")}
              </label>
              {opponents.length === 0 ? (
                <p
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "var(--font-sm)",
                  }}
                >
                  {t("live.noTeams")}
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    gap: "var(--space-2)",
                    overflowX: "auto",
                    paddingBottom: "var(--space-1)",
                    marginInline: "calc(var(--space-4) * -1)",
                    paddingInline: "var(--space-4)",
                    scrollbarWidth: "thin",
                  }}
                >
                  {opponents.map((o) => (
                    <ToggleChip
                      key={o.teamId}
                      checked={opponentId === o.teamId}
                      onClick={() => {
                        haptic.selection();
                        setOpponentId(opponentId === o.teamId ? "" : o.teamId);
                      }}
                    >
                      {teamLabel(o)}
                    </ToggleChip>
                  ))}
                </div>
              )}
            </div>

            <Stack gap="sm">
              <SetRow
                label={t("live.set", { n: 1 })}
                a={s1a}
                b={s1b}
                onA={setS1a}
                onB={setS1b}
                disabled={busy}
              />
              <SetRow
                label={t("live.set", { n: 2 })}
                a={s2a}
                b={s2b}
                onA={setS2a}
                onB={setS2b}
                disabled={busy}
              />
              <SetRow
                label={t("live.set", { n: 3 })}
                a={s3a}
                b={s3b}
                onA={setS3a}
                onB={setS3b}
                disabled={busy}
              />
            </Stack>

            <Button
              onClick={() => void submitMatch()}
              disabled={!canSubmit}
              loading={busy}
              fullWidth
              size="lg"
              leftIcon={<Trophy size={18} />}
              style={{ display: inTelegram ? "none" : undefined }}
            >
              {t("live.submitMatch")}
            </Button>
          </Stack>
        </Card>

        {/* ─── 3e. Recent matches ─────────────────────────────────────── */}
        <Card>
          <SectionTitle>{t("live.recent")}</SectionTitle>
          {matches.length === 0 ? (
            <EmptyState icon={<Flag size={28} />} title={t("live.noMatches")} />
          ) : (
            <Stack gap="xs">
              {matches.slice(0, 20).map((m) => {
                const involvesMe =
                  m.teamAId === myTeam.id || m.teamBId === myTeam.id;
                const iSubmitted =
                  m.submittedByUserId === myTeam.players[0]?.userId ||
                  m.submittedByUserId === myTeam.players[1]?.userId;
                const canConfirm =
                  involvesMe && m.status === "submitted" && !iSubmitted;
                const canDispute = involvesMe && m.status !== "disputed";
                const labelA = teamLabelById(m.teamAId);
                const labelB = teamLabelById(m.teamBId);
                const score = m.sets.map((s) => `${s.a}-${s.b}`).join(", ");
                const statusV =
                  m.status === "confirmed"
                    ? "success"
                    : m.status === "disputed"
                      ? "danger"
                      : "warning";
                return (
                  <Card
                    key={m.id}
                    variant="flat"
                    padding="sm"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <Stack gap="xs">
                      <Inline justify="space-between" wrap gap="sm">
                        <span
                          style={{
                            fontWeight: "var(--weight-semibold)",
                            fontSize: "var(--font-sm)",
                          }}
                        >
                          {m.winner === "A" ? (
                            <strong>{labelA}</strong>
                          ) : (
                            labelA
                          )}{" "}
                          <span style={{ color: "var(--text-muted)" }}>vs</span>{" "}
                          {m.winner === "B" ? (
                            <strong>{labelB}</strong>
                          ) : (
                            labelB
                          )}
                        </span>
                        <Badge variant={statusV} size="sm">
                          {t(`live.matchStatus.${m.status}`)}
                        </Badge>
                      </Inline>
                      <span
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          fontSize: "var(--font-md)",
                          fontWeight: "var(--weight-bold)",
                        }}
                      >
                        {score}
                      </span>
                      {canConfirm ||
                      canDispute ||
                      (isAdmin && m.status === "disputed") ||
                      isAdmin ? (
                        <Inline gap="xs" wrap>
                          {canConfirm ? (
                            <Button
                              variant="success"
                              size="sm"
                              leftIcon={<CheckCircle2 size={14} />}
                              onClick={() => void confirmMatch(m.id)}
                              disabled={busy}
                            >
                              {t("live.confirm")}
                            </Button>
                          ) : null}
                          {canDispute ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              leftIcon={<AlertTriangle size={14} />}
                              onClick={() => void disputeMatch(m.id)}
                              disabled={busy}
                            >
                              {t("live.dispute")}
                            </Button>
                          ) : null}
                          {isAdmin && m.status === "disputed" ? (
                            <Button
                              variant="success"
                              size="sm"
                              onClick={() => void adminForceConfirm(m.id)}
                              disabled={busy}
                            >
                              {t("admin.resolveConfirm")}
                            </Button>
                          ) : null}
                          {isAdmin ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<Edit3 size={14} />}
                              onClick={() => void adminEditMatch(m)}
                              disabled={busy}
                            >
                              {t("admin.edit")}
                            </Button>
                          ) : null}
                          {isAdmin ? (
                            <Button
                              variant="danger"
                              size="sm"
                              leftIcon={<Trash2 size={14} />}
                              onClick={() => void adminDeleteMatch(m)}
                              disabled={busy}
                            >
                              {t("admin.delete")}
                            </Button>
                          ) : null}
                        </Inline>
                      ) : null}
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
          )}
        </Card>

        {/* ─── Leaderboard ────────────────────────────────────────────── */}
        {board ? (
          <Card>
            <SectionTitle>{t("live.leaderboard")}</SectionTitle>
            {board.ranked.length === 0 && board.needsMore.length === 0 ? (
              <EmptyState
                icon={<Trophy size={28} />}
                title={t("live.noTeams")}
              />
            ) : (
              <Stack gap="xs">
                {board.ranked.map((r, i) => (
                  <LeaderboardRowView
                    key={r.teamId}
                    rank={i + 1}
                    row={r}
                    isMine={r.teamId === myTeam.id}
                  />
                ))}
                {board.needsMore.length > 0 ? (
                  <>
                    <p
                      style={{
                        fontSize: "var(--font-xs)",
                        color: "var(--text-muted)",
                        marginTop: "var(--space-2)",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        fontWeight: "var(--weight-semibold)",
                      }}
                    >
                      {t("live.needsMore", {
                        n: board.minMatchesForRanking,
                      })}
                    </p>
                    {board.needsMore.map((r) => (
                      <LeaderboardRowView
                        key={r.teamId}
                        rank={null}
                        row={r}
                        isMine={r.teamId === myTeam.id}
                        faded
                      />
                    ))}
                  </>
                ) : null}
              </Stack>
            )}
          </Card>
        ) : null}

        {error ? (
          <Card
            variant="flat"
            padding="sm"
            style={{ borderColor: "var(--danger)" }}
          >
            <Inline gap="sm" align="center">
              <AlertTriangle color="var(--danger)" size={18} />
              <span
                style={{ color: "var(--danger)", fontSize: "var(--font-sm)" }}
              >
                {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
              </span>
            </Inline>
          </Card>
        ) : null}
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Smaller helpers
 * ────────────────────────────────────────────────────────────────────────── */

function MetricStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "danger";
}): JSX.Element {
  const color =
    tone === "success"
      ? "var(--success)"
      : tone === "danger"
        ? "var(--danger)"
        : "var(--text)";
  return (
    <div
      style={{
        background: "var(--surface-2)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: "var(--font-2xl)",
          fontWeight: "var(--weight-bold)",
          color,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: "var(--font-xs)",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: "var(--weight-semibold)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function SetRow({
  label,
  a,
  b,
  onA,
  onB,
  disabled,
}: {
  label: string;
  a: number | "";
  b: number | "";
  onA: (v: number | "") => void;
  onB: (v: number | "") => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <Inline gap="md" justify="space-between" align="center" wrap>
      <span
        style={{
          fontSize: "var(--font-sm)",
          color: "var(--text-muted)",
          fontWeight: "var(--weight-semibold)",
          minWidth: 48,
        }}
      >
        {label}
      </span>
      <SetScoreInput
        a={a}
        b={b}
        onChangeA={onA}
        onChangeB={onB}
        disabled={disabled}
      />
    </Inline>
  );
}

function LeaderboardRowView({
  rank,
  row,
  isMine,
  faded,
}: {
  rank: number | null;
  row: LeaderboardRow;
  isMine: boolean;
  faded?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const podiumBg =
    rank === 1
      ? "color-mix(in srgb, var(--podium-gold) 18%, transparent)"
      : rank === 2
        ? "color-mix(in srgb, var(--podium-silver) 22%, transparent)"
        : rank === 3
          ? "color-mix(in srgb, var(--podium-bronze) 18%, transparent)"
          : "var(--surface-2)";
  const podiumColor =
    rank === 1
      ? "var(--podium-gold)"
      : rank === 2
        ? "var(--podium-silver)"
        : rank === 3
          ? "var(--podium-bronze)"
          : "var(--text-muted)";
  const teamLabel = row.players.map(fullName).join(" + ");
  const firstPlayer = row.players[0];
  return (
    <ListRow
      bordered
      selected={isMine}
      style={faded ? { opacity: 0.7 } : undefined}
      leading={
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "var(--radius-pill)",
            background: podiumBg,
            color: podiumColor,
            fontWeight: "var(--weight-bold)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {rank === 1 || rank === 2 || rank === 3 ? (
            <Crown size={18} fill="currentColor" />
          ) : rank !== null ? (
            rank
          ) : (
            "·"
          )}
        </span>
      }
      primary={teamLabel}
      secondary={
        <Inline gap="sm" align="center">
          <span>
            {t("live.col.played")}: <strong>{row.matches}</strong>
          </span>
          <span>·</span>
          <span>
            {t("live.col.wins")}: <strong>{row.wins}</strong>
          </span>
          <span>·</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {row.setsFor}-{row.setsAgainst}
          </span>
        </Inline>
      }
      trailing={
        firstPlayer ? (
          <Avatar
            id={firstPlayer.userId}
            name={fullName(firstPlayer)}
            size={28}
          />
        ) : null
      }
    />
  );
}

// Inline text-input style for the few places that still need a real <input>.
const textInputStyle: CSSProperties = {
  padding: "var(--space-3) var(--space-4)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  fontSize: "var(--font-md)",
  background: "var(--surface)",
  color: "var(--text)",
  minHeight: "var(--tap-min)",
  width: "100%",
};
