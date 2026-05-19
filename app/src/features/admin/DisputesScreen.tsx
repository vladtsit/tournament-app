import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, ApiClientError } from "../../apiClient";
import { haptic } from "../../telegram";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Inline,
  Modal,
  Spinner,
  Stack,
} from "../../ui";

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
  const { t, i18n } = useTranslation();
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const first = m.sets[0];
      const current = first ? `${first.a}-${first.b}` : "";
      const raw = window.prompt(t("admin.editPrompt"), current);
      if (raw === null) return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const mm = /^(\d+)[-:](\d+)$/.exec(trimmed);
      if (!mm) {
        setError("invalid_set_score");
        return;
      }
      const a = Number(mm[1]);
      const b = Number(mm[2]);
      if (a === b) {
        setError("invalid_set_score");
        return;
      }
      const sets: Array<{ a: number; b: number }> = [{ a, b }];
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

  const dateFmt = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.disputesTitle")}
      trailing={
        matches.length > 0 ? (
          <Badge variant="danger" size="sm">
            {matches.length}
          </Badge>
        ) : null
      }
    >
      <Stack gap="md">
        {loading ? (
          <Inline justify="center" style={{ padding: "var(--space-4)" }}>
            <Spinner size={28} />
          </Inline>
        ) : matches.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title={t("admin.noDisputes")}
          />
        ) : (
          <Stack gap="sm">
            {matches.map((m) => {
              const scoreStr = m.sets.map((s) => `${s.a}-${s.b}`).join("  ·  ");
              return (
                <Card key={m.id} variant="flat">
                  <Stack gap="sm">
                    <Inline gap="sm" justify="space-between" align="flex-start">
                      <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "var(--font-md)",
                            fontWeight: "var(--weight-semibold)",
                            wordBreak: "break-word",
                          }}
                        >
                          {labelFor(m.teamAId)}
                          <span
                            style={{
                              color: "var(--text-muted)",
                              fontWeight: "var(--weight-normal)",
                              margin: "0 var(--space-2)",
                            }}
                          >
                            vs
                          </span>
                          {labelFor(m.teamBId)}
                        </div>
                        <div
                          style={{
                            fontSize: "var(--font-sm)",
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--text)",
                          }}
                        >
                          {scoreStr}
                        </div>
                      </Stack>
                      <Badge variant="warning" size="sm" dot>
                        {t("tournament.status.disputed", {
                          defaultValue: "Disputed",
                        })}
                      </Badge>
                    </Inline>

                    <div
                      style={{
                        fontSize: "var(--font-xs)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {dateFmt.format(new Date(m.submittedAt))}
                      {" · "}
                      {t("admin.submittedBy", {
                        name: m.submittedByUserId.slice(0, 8),
                      })}
                    </div>

                    <Inline gap="xs" wrap>
                      <Button
                        size="sm"
                        variant="success"
                        leftIcon={<CheckCircle2 size={16} />}
                        onClick={() => void resolve(m.id)}
                        disabled={busy}
                      >
                        {t("admin.resolveConfirm")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={<Edit3 size={16} />}
                        onClick={() => void editMatch(m)}
                        disabled={busy}
                      >
                        {t("admin.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        leftIcon={<Trash2 size={16} />}
                        onClick={() => void deleteMatch(m)}
                        disabled={busy}
                      >
                        {t("admin.delete")}
                      </Button>
                    </Inline>
                  </Stack>
                </Card>
              );
            })}
          </Stack>
        )}

        {error ? (
          <Inline
            gap="xs"
            align="center"
            style={{
              color: "var(--danger)",
              fontSize: "var(--font-sm)",
            }}
          >
            <AlertTriangle size={14} />
            <span>
              {t(`errors.${error}`, { defaultValue: t("app.errorGeneric") })}
            </span>
          </Inline>
        ) : null}
      </Stack>
    </Modal>
  );
}
