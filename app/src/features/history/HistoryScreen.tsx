import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiClientError } from "../../apiClient";

interface PodiumPlayer {
  userId: string;
  displayName: string;
}

interface PodiumEntry {
  rank: number;
  teamId: string;
  players: PodiumPlayer[];
  wins: number;
  losses: number;
}

interface HistoryItem {
  id: string;
  name: string;
  endedAt?: string;
  podium: PodiumEntry[];
}

interface HistoryResponse {
  tournaments: HistoryItem[];
}

export function HistoryScreen(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<HistoryResponse>("/api/tournaments/history?limit=20");
      setItems(r.tournaments);
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
  if (items.length === 0) {
    return <p style={{ opacity: 0.7 }}>{t("history.empty")}</p>;
  }
  const dateFmt = new Intl.DateTimeFormat(i18n.language, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((item) => (
        <section key={item.id} style={cardStyle}>
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 8,
            }}
          >
            <h3 style={{ fontSize: 15, margin: 0 }}>{item.name}</h3>
            {item.endedAt && (
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                {dateFmt.format(new Date(item.endedAt))}
              </span>
            )}
          </header>
          {item.podium.length === 0 ? (
            <p style={{ opacity: 0.6, fontSize: 13, margin: 0 }}>
              {t("history.noResults")}
            </p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
              {item.podium.map((p) => (
                <li key={p.teamId}>
                  {medalFor(p.rank)} {p.players.map((u) => u.displayName).join(" + ")}
                  <span style={{ opacity: 0.7, marginLeft: 8, fontSize: 12 }}>
                    {p.wins}W–{p.losses}L
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

function medalFor(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--tg-theme-section-separator-color, #e5e5e5)",
  borderRadius: 10,
  padding: 12,
};
