import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiClientError } from "../../apiClient";

interface PlayerSummary {
  userId: string;
  firstName: string;
}

interface RegistrationDoc {
  userId: string;
  firstName: string;
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
  players: Array<{ userId: string; firstName: string; isSelf: boolean }>;
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
      await api("/api/tournaments", { method: "POST", body: {} });
      await reload();
    } catch (err) {
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
        await reload();
      } catch (err) {
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [data, reload],
  );

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
          <button
            type="button"
            onClick={() => void createTournament()}
            disabled={busy}
            style={btnPrimary}
          >
            {t("tournament.create")}
          </button>
        )}
      </div>
    );
  }

  const reg = data.registration;
  const playing = reg?.playing === true;
  const bbq = reg?.bbq === true;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 18, margin: "0 0 4px 0" }}>
          {data.tournament.name}
        </h2>
        <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>
          {t("tournament.counts", {
            playing: data.counts.playing,
            bbq: data.counts.bbq,
          })}
        </p>
      </header>

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

      {playing && (
        <TeamSection
          tournamentId={data.tournament.id}
          team={data.team}
          onChange={reload}
        />
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
    async (partnerUserId: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await api(`/api/tournaments/${tournamentId}/teams`, {
          method: "POST",
          body: { partnerUserId },
          idempotencyKey: `team-${tournamentId}-${partnerUserId}-${Date.now()}`,
        });
        await onChange();
      } catch (err) {
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [tournamentId, onChange],
  );

  return (
    <section style={cardStyle}>
      <h3 style={sectionTitle}>{t("teams.title")}</h3>
      {team ? (
        <p>
          {t("teams.you")}: {team.players.map((p) => p.firstName).join(" + ")}
        </p>
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
                <span>{p.firstName}</span>
                <button
                  type="button"
                  onClick={() => void pair(p.userId)}
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

const btnSmall: CSSProperties = {
  ...btnBase,
  padding: "4px 10px",
  fontSize: 13,
};

const listRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 0",
  borderBottom: "1px solid var(--tg-theme-section-separator-color, #eee)",
};
