import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiClientError } from "../../apiClient";
import { haptic } from "../../telegram";

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

interface Props {
  isAdmin: boolean;
}

export function TournamentScreen({ isAdmin }: Props): JSX.Element {
  const { t } = useTranslation();
  const [data, setData] = useState<CurrentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftName, setDraftName] = useState("");

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

  useEffect(() => {
    void reload();
  }, [reload]);

  const createTournament = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const name = draftName.trim();
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
  }, [reload, draftName]);

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

  if (loading) return <p>…</p>;
  if (error)
    return (
      <p style={{ color: "var(--tg-theme-destructive-text-color, #c00)" }}>
        {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
      </p>
    );

  if (!data?.tournament) {
    return (
      <div>
        <p>{t("tournament.none")}</p>
        {isAdmin && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label
              htmlFor="tournament-name"
              style={{ fontSize: 13, opacity: 0.8 }}
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
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => void createTournament()}
              disabled={busy}
              style={btnPrimary}
            >
              {t("tournament.create")}
            </button>
          </div>
        )}
      </div>
    );
  }

  const reg = data.registration;
  const playing = reg?.playing === true;
  const bbq = reg?.bbq === true;
  const status = data.tournament.status;
  const isLive = status === "live";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 18, margin: "0 0 4px 0" }}>
          {data.tournament.name}{" "}
          <span style={statusBadge(status)}>
            {t(`tournament.status.${status}`)}
          </span>
        </h2>
        <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>
          {t("tournament.counts", {
            playing: data.counts.playing,
            bbq: data.counts.bbq,
          })}
        </p>
      </header>

      {!isLive && (
        <section style={cardStyle}>
          <h3 style={sectionTitle}>{t("registration.title")}</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Toggle
              label={t("registration.playing")}
              on={playing}
              disabled={busy}
              onClick={() => void upsertRegistration(!playing, bbq)}
            />
            <Toggle
              label={t("registration.bbq")}
              on={bbq}
              disabled={busy}
              onClick={() => void upsertRegistration(playing, !bbq)}
            />
          </div>
        </section>
      )}

      {!isLive && playing && (
        <TeamSection
          tournamentId={data.tournament.id}
          team={data.team}
          onChange={reload}
        />
      )}

      {!isLive && isAdmin && status === "registration_open" && (
        <button
          type="button"
          onClick={() => void startTournament()}
          disabled={busy}
          style={btnPrimary}
        >
          {t("tournament.start")}
        </button>
      )}

      {isLive && data.team && (
        <LiveSection tournamentId={data.tournament.id} myTeam={data.team} />
      )}
      {isLive && !data.team && (
        <section style={cardStyle}>
          <p style={{ opacity: 0.8 }}>{t("live.notInTeam")}</p>
        </section>
      )}

      {isLive && isAdmin && (
        <button
          type="button"
          onClick={() => void endTournament()}
          disabled={busy}
          style={btnDanger}
        >
          {t("tournament.end")}
        </button>
      )}
    </div>
  );
}

function TeamSection({
  tournamentId,
  team,
  onChange,
}: {
  tournamentId: string;
  team: TeamDoc | null;
  onChange: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<LookingResponse["players"]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (team) {
      setPlayers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await api<LookingResponse>(
        `/api/tournaments/${tournamentId}/looking-for-teammate`,
      );
      setPlayers(r.players);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setLoading(false);
    }
  }, [team, tournamentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pair = useCallback(
    async (partnerUserId: string, partnerLabel: string): Promise<void> => {
      if (
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
        haptic.notify("success");
        await onChange();
      } catch (err) {
        haptic.notify("error");
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [tournamentId, onChange, t],
  );

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

  return (
    <section style={cardStyle}>
      <h3 style={sectionTitle}>{t("teams.title")}</h3>
      {team ? (
        <>
          <p style={{ margin: "0 0 8px 0" }}>
            {t("teams.you")}: {team.players.map(fullName).join(" + ")}
          </p>
          <button
            type="button"
            onClick={() => void leaveTeam()}
            disabled={busy}
            style={btnSmallDanger}
          >
            {t("teams.leave")}
          </button>
        </>
      ) : loading ? (
        <p>…</p>
      ) : players.filter((p) => !p.isSelf).length === 0 ? (
        <p style={{ opacity: 0.7 }}>{t("teams.nooneLooking")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {players
            .filter((p) => !p.isSelf)
            .map((p) => (
              <li key={p.userId} style={listRow}>
                <span>{fullName(p)}</span>
                <button
                  type="button"
                  onClick={() => void pair(p.userId, fullName(p))}
                  disabled={busy}
                  style={btnSmall}
                >
                  {t("teams.pair")}
                </button>
              </li>
            ))}
        </ul>
      )}
      {error && (
        <p
          style={{
            color: "var(--tg-theme-destructive-text-color, #c00)",
            fontSize: 13,
          }}
        >
          {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
        </p>
      )}
    </section>
  );
}

function Toggle({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...btnBase,
        background: on
          ? "var(--tg-theme-button-color, #2ea6ff)"
          : "var(--tg-theme-secondary-bg-color, #f1f1f1)",
        color: on
          ? "var(--tg-theme-button-text-color, #fff)"
          : "var(--tg-theme-text-color, #000)",
      }}
    >
      {on ? "✓ " : ""}
      {label}
    </button>
  );
}

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
}: {
  tournamentId: string;
  myTeam: TeamDoc;
}): JSX.Element {
  const { t } = useTranslation();
  const [opponents, setOpponents] = useState<OpponentRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set inputs: 3 rows of {a,b} (third optional).
  const [s1a, setS1a] = useState("");
  const [s1b, setS1b] = useState("");
  const [s2a, setS2a] = useState("");
  const [s2b, setS2b] = useState("");
  const [s3a, setS3a] = useState("");
  const [s3b, setS3b] = useState("");
  const [opponentId, setOpponentId] = useState("");

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
    const triples: Array<[string, string]> = [
      [s1a, s1b],
      [s2a, s2b],
      [s3a, s3b],
    ];
    for (const [a, b] of triples) {
      if (a === "" && b === "") continue;
      const ai = Number(a);
      const bi = Number(b);
      if (!Number.isFinite(ai) || !Number.isFinite(bi)) {
        setError("invalid_set_score");
        return;
      }
      sets.push({ a: ai, b: bi });
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

  if (loading) return <p>…</p>;

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

  return (
    <>
      <section style={cardStyle}>
        <h3 style={sectionTitle}>{t("live.submit")}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13, opacity: 0.8 }}>
            {t("live.opponent")}
          </label>
          <select
            value={opponentId}
            onChange={(e) => setOpponentId(e.target.value)}
            disabled={busy}
            style={inputStyle}
          >
            <option value="">{t("live.pickOpponent")}</option>
            {opponents.map((o) => (
              <option key={o.teamId} value={o.teamId}>
                {teamLabel(o)} — {o.matchesPlayed}
              </option>
            ))}
          </select>
          <SetInputs
            label={t("live.set", { n: 1 })}
            a={s1a}
            b={s1b}
            setA={setS1a}
            setB={setS1b}
            disabled={busy}
          />
          <SetInputs
            label={t("live.set", { n: 2 })}
            a={s2a}
            b={s2b}
            setA={setS2a}
            setB={setS2b}
            disabled={busy}
          />
          <SetInputs
            label={t("live.set", { n: 3 })}
            a={s3a}
            b={s3b}
            setA={setS3a}
            setB={setS3b}
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void submitMatch()}
            disabled={busy}
            style={btnPrimary}
          >
            {t("live.submitMatch")}
          </button>
        </div>
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitle}>{t("live.recent")}</h3>
        {matches.length === 0 ? (
          <p style={{ opacity: 0.7 }}>{t("live.noMatches")}</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {matches.slice(0, 20).map((m) => {
              const involvesMe =
                m.teamAId === myTeam.id || m.teamBId === myTeam.id;
              const iSubmitted =
                m.submittedByUserId === myTeam.players[0]?.userId ||
                m.submittedByUserId === myTeam.players[1]?.userId;
              const canConfirm =
                involvesMe && m.status === "submitted" && !iSubmitted;
              const canDispute = involvesMe && m.status !== "disputed";
              return (
                <li key={m.id} style={listRow}>
                  <span style={{ fontSize: 13 }}>
                    {teamLabelById(m.teamAId)} vs {teamLabelById(m.teamBId)}
                    {" — "}
                    {m.sets.map((s) => `${s.a}-${s.b}`).join(", ")}
                    {"  "}
                    <em style={{ opacity: 0.7 }}>
                      [{t(`live.matchStatus.${m.status}`)}]
                    </em>
                  </span>
                  <span style={{ display: "flex", gap: 6 }}>
                    {canConfirm && (
                      <button
                        type="button"
                        onClick={() => void confirmMatch(m.id)}
                        disabled={busy}
                        style={btnSmall}
                      >
                        {t("live.confirm")}
                      </button>
                    )}
                    {canDispute && (
                      <button
                        type="button"
                        onClick={() => void disputeMatch(m.id)}
                        disabled={busy}
                        style={btnSmall}
                      >
                        {t("live.dispute")}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {board && (
        <section style={cardStyle}>
          <h3 style={sectionTitle}>{t("live.leaderboard")}</h3>
          {board.ranked.length === 0 && board.needsMore.length === 0 ? (
            <p style={{ opacity: 0.7 }}>{t("live.noTeams")}</p>
          ) : (
            <>
              <LeaderboardTable rows={board.ranked} />
              {board.needsMore.length > 0 && (
                <>
                  <p
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      margin: "8px 0 4px",
                    }}
                  >
                    {t("live.needsMore", {
                      n: board.minMatchesForRanking,
                    })}
                  </p>
                  <LeaderboardTable rows={board.needsMore} faded />
                </>
              )}
            </>
          )}
        </section>
      )}

      {error && (
        <p
          style={{
            color: "var(--tg-theme-destructive-text-color, #c00)",
            fontSize: 13,
          }}
        >
          {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
        </p>
      )}
    </>
  );
}

function SetInputs({
  label,
  a,
  b,
  setA,
  setB,
  disabled,
}: {
  label: string;
  a: string;
  b: string;
  setA: (v: string) => void;
  setB: (v: string) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 13, width: 56, opacity: 0.8 }}>{label}</span>
      <input
        type="number"
        min={0}
        max={20}
        value={a}
        onChange={(e) => setA(e.target.value)}
        disabled={disabled}
        style={{ ...inputStyle, width: 60 }}
      />
      <span>–</span>
      <input
        type="number"
        min={0}
        max={20}
        value={b}
        onChange={(e) => setB(e.target.value)}
        disabled={disabled}
        style={{ ...inputStyle, width: 60 }}
      />
    </div>
  );
}

function LeaderboardTable({
  rows,
  faded,
}: {
  rows: LeaderboardRow[];
  faded?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 13,
        opacity: faded ? 0.7 : 1,
      }}
    >
      <thead>
        <tr style={{ textAlign: "left" }}>
          <th>#</th>
          <th>{t("live.col.team")}</th>
          <th>{t("live.col.played")}</th>
          <th>{t("live.col.wins")}</th>
          <th>{t("live.col.sets")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.teamId}>
            <td>{i + 1}</td>
            <td>{r.players.map(fullName).join(" + ")}</td>
            <td>{r.matches}</td>
            <td>{r.wins}</td>
            <td>
              {r.setsFor}-{r.setsAgainst}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function statusBadge(status: TournamentDoc["status"]): CSSProperties {
  const bg =
    status === "live"
      ? "#1aa260"
      : status === "registration_open"
        ? "#2ea6ff"
        : status === "ended"
          ? "#888"
          : "#bbb";
  return {
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 10,
    background: bg,
    color: "#fff",
    marginLeft: 6,
    verticalAlign: "middle",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  };
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--tg-theme-section-separator-color, #e5e5e5)",
  borderRadius: 10,
  padding: 12,
};

const sectionTitle: CSSProperties = {
  fontSize: 14,
  margin: "0 0 8px 0",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  opacity: 0.8,
};

const btnBase: CSSProperties = {
  padding: "8px 14px",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
};

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: "var(--tg-theme-button-color, #2ea6ff)",
  color: "var(--tg-theme-button-text-color, #fff)",
};

const btnDanger: CSSProperties = {
  ...btnBase,
  background: "var(--tg-theme-destructive-text-color, #c0392b)",
  color: "#fff",
};

const btnSmall: CSSProperties = {
  ...btnBase,
  padding: "4px 10px",
  fontSize: 13,
};

const btnSmallDanger: CSSProperties = {
  ...btnSmall,
  background: "var(--tg-theme-destructive-text-color, #c0392b)",
  color: "#fff",
};

const listRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 0",
  borderBottom: "1px solid var(--tg-theme-section-separator-color, #eee)",
};

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  border: "1px solid var(--tg-theme-section-separator-color, #ccc)",
  borderRadius: 8,
  fontSize: 14,
  background: "var(--tg-theme-bg-color, #fff)",
  color: "var(--tg-theme-text-color, #000)",
};
