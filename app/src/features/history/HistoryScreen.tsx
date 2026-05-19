import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Crown, History, Medal, Trophy } from "lucide-react";
import { api, ApiClientError } from "../../apiClient";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  Inline,
  ListRow,
  SectionTitle,
  Spinner,
  Stack,
} from "../../ui";

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

  if (loading) {
    return (
      <Inline justify="center" style={{ padding: "var(--space-5)" }}>
        <Spinner size={28} />
      </Inline>
    );
  }

  if (error) {
    return (
      <Card>
        <p style={{ color: "var(--danger)" }}>
          {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
        </p>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={<History size={32} />} title={t("history.empty")} />
      </Card>
    );
  }

  const dateFmt = new Intl.DateTimeFormat(i18n.language, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <Stack gap="md">
      {items.map((item) => (
        <Card key={item.id}>
          <Inline justify="space-between" align="flex-start" gap="sm">
            <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
              <h3
                style={{
                  fontSize: "var(--font-md)",
                  fontWeight: "var(--weight-bold)",
                  wordBreak: "break-word",
                }}
              >
                {item.name}
              </h3>
              {item.endedAt ? (
                <Inline gap="xs" align="center">
                  <Calendar size={12} color="var(--text-muted)" />
                  <span
                    style={{
                      fontSize: "var(--font-xs)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {dateFmt.format(new Date(item.endedAt))}
                  </span>
                </Inline>
              ) : null}
            </Stack>
            <Badge variant="neutral" size="sm">
              {t("tournament.status.ended")}
            </Badge>
          </Inline>

          {item.podium.length === 0 ? (
            <div style={{ marginTop: "var(--space-3)" }}>
              <EmptyState
                icon={<Trophy size={24} />}
                title={t("history.noResults")}
              />
            </div>
          ) : (
            <div style={{ marginTop: "var(--space-3)" }}>
              <SectionTitle>{t("live.leaderboard")}</SectionTitle>
              <Stack gap="xs">
                {item.podium.map((p) => (
                  <PodiumRow key={p.teamId} entry={p} />
                ))}
              </Stack>
            </div>
          )}
        </Card>
      ))}
    </Stack>
  );
}

function PodiumRow({ entry }: { entry: PodiumEntry }): JSX.Element {
  const medalBg =
    entry.rank === 1
      ? "color-mix(in srgb, var(--podium-gold) 18%, transparent)"
      : entry.rank === 2
        ? "color-mix(in srgb, var(--podium-silver) 22%, transparent)"
        : entry.rank === 3
          ? "color-mix(in srgb, var(--podium-bronze) 18%, transparent)"
          : "var(--surface-2)";
  const medalColor =
    entry.rank === 1
      ? "var(--podium-gold)"
      : entry.rank === 2
        ? "var(--podium-silver)"
        : entry.rank === 3
          ? "var(--podium-bronze)"
          : "var(--text-muted)";
  const firstPlayer = entry.players[0];
  const label = entry.players.map((u) => u.displayName).join(" + ");
  return (
    <ListRow
      bordered
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
            background: medalBg,
            color: medalColor,
          }}
        >
          {entry.rank <= 3 ? (
            entry.rank === 1 ? (
              <Crown size={18} fill="currentColor" />
            ) : (
              <Medal size={18} fill="currentColor" />
            )
          ) : (
            <span
              style={{
                fontWeight: "var(--weight-bold)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {entry.rank}
            </span>
          )}
        </span>
      }
      primary={label}
      secondary={`${entry.wins}W – ${entry.losses}L`}
      trailing={
        firstPlayer ? (
          <Avatar
            id={firstPlayer.userId}
            name={firstPlayer.displayName}
            size={28}
          />
        ) : null
      }
    />
  );
}
