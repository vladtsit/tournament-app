import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Crown, Medal } from "lucide-react";
import { api, ApiClientError } from "../../apiClient";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  Inline,
  ListRow,
  Spinner,
  Stack,
} from "../../ui";

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

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<BarChart3 size={32} />}
          title={t("overall.empty")}
        />
      </Card>
    );
  }

  return (
    <Stack gap="xs">
      {rows.map((r) => (
        <OverallRowView key={r.userId} row={r} />
      ))}
    </Stack>
  );
}

function OverallRowView({ row }: { row: OverallRow }): JSX.Element {
  const { t } = useTranslation();
  const rankBg =
    row.rank === 1
      ? "color-mix(in srgb, var(--podium-gold) 18%, transparent)"
      : row.rank === 2
        ? "color-mix(in srgb, var(--podium-silver) 22%, transparent)"
        : row.rank === 3
          ? "color-mix(in srgb, var(--podium-bronze) 18%, transparent)"
          : "var(--surface-2)";
  const rankColor =
    row.rank === 1
      ? "var(--podium-gold)"
      : row.rank === 2
        ? "var(--podium-silver)"
        : row.rank === 3
          ? "var(--podium-bronze)"
          : "var(--text-muted)";
  return (
    <ListRow
      bordered
      selected={row.isMe}
      leading={
        <Inline gap="sm" align="center">
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "var(--radius-pill)",
              background: rankBg,
              color: rankColor,
              fontWeight: "var(--weight-bold)",
              fontVariantNumeric: "tabular-nums",
              fontSize: "var(--font-sm)",
            }}
          >
            {row.rank <= 3 ? (
              row.rank === 1 ? (
                <Crown size={16} fill="currentColor" />
              ) : (
                <Medal size={16} fill="currentColor" />
              )
            ) : (
              row.rank
            )}
          </span>
          <Avatar id={row.userId} name={row.displayName} size={36} />
        </Inline>
      }
      primary={
        <Inline gap="sm" justify="space-between" align="center">
          <span>{row.displayName}</span>
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              fontWeight: "var(--weight-bold)",
              color: row.isMe ? "var(--accent)" : "var(--text)",
            }}
          >
            {row.overallScore.toFixed(2)}
          </span>
        </Inline>
      }
      secondary={
        <Inline gap="xs" wrap align="center">
          <span>
            {t("overall.col.tournaments")}: <strong>{row.tournamentsPlayed}</strong>
          </span>
          <span>·</span>
          <span>
            {t("overall.col.wins")}: <strong>{row.wins}</strong>
          </span>
          {row.podiums.first + row.podiums.second + row.podiums.third > 0 ? (
            <>
              <span>·</span>
              <Inline gap="xs">
                {row.podiums.first > 0 ? (
                  <Badge variant="gold" size="sm">
                    🥇 {row.podiums.first}
                  </Badge>
                ) : null}
                {row.podiums.second > 0 ? (
                  <Badge variant="silver" size="sm">
                    🥈 {row.podiums.second}
                  </Badge>
                ) : null}
                {row.podiums.third > 0 ? (
                  <Badge variant="bronze" size="sm">
                    🥉 {row.podiums.third}
                  </Badge>
                ) : null}
              </Inline>
            </>
          ) : null}
        </Inline>
      }
    />
  );
}
