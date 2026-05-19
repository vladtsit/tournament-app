import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiClientError } from "../../apiClient";
import { haptic } from "../../telegram";
import { useBackButton } from "../../hooks/useBackButton";

interface PlayerSummary {
  userId: string;
  firstName: string;
  lastName?: string;
}

interface MatchRow {
  id: string;
  teamAId: string;
  teamBId: string;
  submittedByUserId: string;
  sets: Array<{ a: number; b: number }>;
  winner: "A" | "B";
  status: "submitted" | "confirmed" | "disputed";
  submittedAt: string;
}

interface LeaderboardRow {
  teamId: string;
  players: PlayerSummary[];
}

interface LeaderboardResponse {
  ranked: LeaderboardRow[];
  needsMore: LeaderboardRow[];
}

interface Props {
  tournamentId: string;
  onClose: () => void;
}

function fullName(p: { firstName: string; lastName?: string }): string {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

export function DisputesScreen({ tournamentId, onClose }: Props): JSX.Element {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackButton(true, onClose);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [ms, lb] = await Promise.all([
        api<{ matches: MatchRow[] }>(
          `/api/tournaments/${tournamentId}/matches`,
        ),
        api<LeaderboardResponse>(
          `/api/tournaments/${tournamentId}/leaderboard`,
        ),
      ]);
      setMatches(ms.matches.filter((m) => m.status === "disputed"));
      const next: Record<string, string> = {};
      for (const r of [...lb.ranked, ...lb.needsMore]) {
        next[r.teamId] = r.players.map(fullName).join(" + ");
      }
      setLabels(next);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    void reload();
    haptic.selection();
  }, [reload]);

  const labelFor = (id: string): string => labels[id] ?? id.slice(0, 6);

  const resolve = useCallback(
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

  const editMatch = useCallback(
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
        const mm = /^(\d+)[-:](\d+)$/.exec(part);
        if (!mm) {
          setError("invalid_set_score");
          return;
        }
        sets.push({ a: Number(mm[1]), b: Number(mm[2]) });
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

  const deleteMatch = useCallback(
    async (m: MatchRow): Promise<void> => {
      const label = m.sets.map((s) => `${s.a}-${s.b}`).join(", ");
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

  return (
    <section
      style={{
        background: "var(--tg-theme-secondary-bg-color, #fafafa)",
        borderRadius: 12,
        padding: 16,
        marginTop: 12,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>{t("admin.disputesTitle")}</h2>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 16,
            color: "var(--tg-theme-link-color, #2ea6ff)",
          }}
        >
          {t("common.close")}
        </button>
      </header>

      {loading ? (
        <p>…</p>
      ) : matches.length === 0 ? (
        <p style={{ opacity: 0.7 }}>{t("admin.noDisputes")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {matches.map((m) => (
            <li
              key={m.id}
              style={{
                padding: "10px 0",
                borderBottom:
                  "1px solid var(--tg-theme-section-separator-color, #eee)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 14 }}>
                <strong>{labelFor(m.teamAId)}</strong> vs{" "}
                <strong>{labelFor(m.teamBId)}</strong>
                {" — "}
                {m.sets.map((s) => `${s.a}-${s.b}`).join(", ")}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {new Date(m.submittedAt).toLocaleString()} ·{" "}
                {t("admin.submittedBy", {
                  name: m.submittedByUserId.slice(0, 8),
                })}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void resolve(m.id)}
                  disabled={busy}
                  style={btnSmall}
                >
                  {t("admin.resolveConfirm")}
                </button>
                <button
                  type="button"
                  onClick={() => void editMatch(m)}
                  disabled={busy}
                  style={btnSmall}
                >
                  {t("admin.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteMatch(m)}
                  disabled={busy}
                  style={btnSmallDanger}
                >
                  {t("admin.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p
          style={{
            color: "var(--tg-theme-destructive-text-color, #c00)",
            fontSize: 13,
            marginTop: 8,
          }}
        >
          {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
        </p>
      )}
    </section>
  );
}

const btnSmall: CSSProperties = {
  padding: "6px 12px",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
  background: "var(--tg-theme-button-color, #2ea6ff)",
  color: "var(--tg-theme-button-text-color, #fff)",
};

const btnSmallDanger: CSSProperties = {
  ...btnSmall,
  background: "var(--tg-theme-destructive-text-color, #c0392b)",
  color: "#fff",
};
