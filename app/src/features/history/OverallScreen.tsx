import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiClientError } from "../../apiClient";

interface OverallRow {
  rank: number;
  userId: string;
  displayName: string;
  isMe: boolean;
  overallScore: number;
  tournamentsPlayed: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  podiums: { first: number; second: number; third: number };
}

interface OverallResponse {
  rows: OverallRow[];
}

export function OverallScreen(): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<OverallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<OverallResponse>("/api/groups/overall-score");
      setRows(r.rows);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.code : "unknown");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) return <p>…</p>;
  if (error) {
    return (
      <p style={{ color: "var(--tg-theme-destructive-text-color, #c00)" }}>
        {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
      </p>
    );
  }
  if (rows.length === 0) {
    return <p style={{ opacity: 0.7 }}>{t("overall.empty")}</p>;
  }
  return (
    <section style={cardStyle}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th>#</th>
            <th>{t("overall.col.player")}</th>
            <th style={{ textAlign: "right" }}>{t("overall.col.score")}</th>
            <th style={{ textAlign: "right" }}>
              {t("overall.col.tournaments")}
            </th>
            <th style={{ textAlign: "right" }}>{t("overall.col.wins")}</th>
            <th style={{ textAlign: "right" }}>🥇/🥈/🥉</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.userId}
              style={{
                background: r.isMe
                  ? "var(--tg-theme-secondary-bg-color, #f3f8ff)"
                  : "transparent",
                fontWeight: r.isMe ? 600 : 400,
              }}
            >
              <td>{r.rank}</td>
              <td>{r.displayName}</td>
              <td style={{ textAlign: "right" }}>
                {r.overallScore.toFixed(2)}
              </td>
              <td style={{ textAlign: "right" }}>{r.tournamentsPlayed}</td>
              <td style={{ textAlign: "right" }}>{r.wins}</td>
              <td style={{ textAlign: "right" }}>
                {r.podiums.first}/{r.podiums.second}/{r.podiums.third}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--tg-theme-section-separator-color, #e5e5e5)",
  borderRadius: 10,
  padding: 12,
};
