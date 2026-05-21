import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unlock,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api, ApiClientError } from "../../apiClient";
import { haptic } from "../../telegram";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Inline,
  ListRow,
  Modal,
  SectionTitle,
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
  resigned?: boolean;
  addedByAdminUserId?: string;
}

interface TeamDoc {
  id: string;
  players: PlayerSummary[];
  confirmedByAdmin?: boolean;
}

interface CourtConfig {
  id: string;
  label: string;
  color: "green" | "blue";
}

interface TournamentDoc {
  id: string;
  name: string;
  status: "draft" | "registration_open" | "review" | "live" | "ended";
  settings?: {
    firstRoundCourts?: Array<{ courtId: string; teamIds: string[] }>;
  };
}

interface CurrentResponse {
  tournament: TournamentDoc | null;
  registration: RegistrationDoc | null;
  team: TeamDoc | null;
  counts: { playing: number; bbq: number };
  registrations?: RegistrationDoc[];
  teams?: TeamDoc[];
  group?: { courts?: CourtConfig[] };
}

interface MembersResponse {
  members: Array<{
    userId: string;
    firstName: string;
    lastName?: string;
    alreadyRegistered?: boolean;
    isPlaying?: boolean;
    resigned?: boolean;
  }>;
}

function fullName(p: { firstName: string; lastName?: string }): string {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

interface Props {
  groupId: string;
  current: CurrentResponse;
  onReload: () => Promise<void>;
}

export function AdminTournamentScreen({
  groupId,
  current,
  onReload,
}: Props): JSX.Element {
  const { t } = useTranslation();
  if (!current.tournament) {
    return <EmptyState icon={<Users />} title={t("tournament.none")} body="" />;
  }
  return (
    <AdminTournamentScreenInner
      groupId={groupId}
      current={current as CurrentResponse & { tournament: TournamentDoc }}
      onReload={onReload}
    />
  );
}

function AdminTournamentScreenInner({
  groupId,
  current,
  onReload,
}: {
  groupId: string;
  current: CurrentResponse & { tournament: TournamentDoc };
  onReload: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const tournament = current.tournament;
  const status = tournament.status;
  const isReview = status === "review";
  const regs = useMemo(
    () => (current.registrations ?? []).filter((r) => r.playing && !r.resigned),
    [current.registrations],
  );
  const resignedRegs = useMemo(
    () => (current.registrations ?? []).filter((r) => r.resigned),
    [current.registrations],
  );
  const teams = useMemo(() => current.teams ?? [], [current.teams]);
  const playerToTeam = useMemo(() => {
    const m = new Map<string, TeamDoc>();
    for (const team of teams) {
      for (const p of team.players) {
        m.set(p.userId, team);
      }
    }
    return m;
  }, [teams]);

  const unpaired = useMemo(
    () => regs.filter((r) => !playerToTeam.has(r.userId)),
    [regs, playerToTeam],
  );

  const courts: CourtConfig[] = current.group?.courts ?? [];
  const firstRoundCourts = useMemo(
    () => tournament.settings?.firstRoundCourts ?? [],
    [tournament.settings?.firstRoundCourts],
  );
  const courtAssignments = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of firstRoundCourts) {
      m.set(a.courtId, [...a.teamIds]);
    }
    return m;
  }, [firstRoundCourts]);
  const assignedTeamIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of firstRoundCourts) {
      for (const id of a.teamIds) s.add(id);
    }
    return s;
  }, [firstRoundCourts]);

  // ── Start-blocking checks ────────────────────────────────────────────
  const oddCount = regs.length % 2 !== 0;
  const unconfirmedCount = teams.filter((t) => !t.confirmedByAdmin).length;
  const courtsAssigned =
    firstRoundCourts.length > 0 &&
    firstRoundCourts.some((c) => c.teamIds.length > 0);
  const canStart =
    isReview && !oddCount && unconfirmedCount === 0 && courtsAssigned;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        haptic.notify("success");
        await onReload();
      } catch (err) {
        haptic.notify("error");
        setError(err instanceof ApiClientError ? err.code : "unknown");
      } finally {
        setBusy(false);
      }
    },
    [onReload],
  );

  const stopRegistration = (): Promise<void> =>
    run(async () => {
      await api(`/api/tournaments/${tournament.id}/stop-registration`, {
        method: "POST",
        body: {},
        idempotencyKey: `stopreg-${tournament.id}-${crypto.randomUUID()}`,
      });
    });
  const reopenRegistration = (): Promise<void> =>
    run(async () => {
      await api(`/api/tournaments/${tournament.id}/reopen-registration`, {
        method: "POST",
        body: {},
        idempotencyKey: `reopen-${tournament.id}-${crypto.randomUUID()}`,
      });
    });
  const startTournament = (): Promise<void> =>
    run(async () => {
      await api(`/api/tournaments/${tournament.id}/start`, {
        method: "POST",
        body: {},
        idempotencyKey: `start-${tournament.id}-${crypto.randomUUID()}`,
      });
    });

  // ── Per-team admin actions ───────────────────────────────────────────
  const toggleConfirm = (team: TeamDoc): Promise<void> =>
    run(async () => {
      await api(`/api/teams/${team.id}/admin-confirm`, {
        method: team.confirmedByAdmin ? "DELETE" : "POST",
        body: {},
      });
    });

  const disbandTeam = (team: TeamDoc): Promise<void> =>
    run(async () => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(t("admin.teams.disband") + "?")
      ) {
        return;
      }
      await api(`/api/teams/${team.id}/admin-disband`, {
        method: "DELETE",
        body: {},
      });
    });

  const removeRegistration = (r: RegistrationDoc): Promise<void> =>
    run(async () => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(t("admin.players.removeConfirm", { name: fullName(r) }))
      ) {
        return;
      }
      await api(
        `/api/tournaments/${tournament.id}/admin/registrations/${r.userId}`,
        { method: "DELETE", body: {} },
      );
    });

  const unlockRegistration = (r: RegistrationDoc): Promise<void> =>
    run(async () => {
      await api(
        `/api/tournaments/${tournament.id}/admin/registrations/${r.userId}/unlock`,
        { method: "POST", body: {} },
      );
    });

  // ── Add-player modal ─────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [members, setMembers] = useState<MembersResponse["members"]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const fetchMembers = useCallback(
    async (q: string): Promise<void> => {
      setMembersLoading(true);
      try {
        const url = `/api/groups/${groupId}/members?tournamentId=${tournament.id}${
          q ? `&q=${encodeURIComponent(q)}` : ""
        }`;
        const res = await api<MembersResponse>(url);
        setMembers(res.members);
      } catch {
        // ignore
      } finally {
        setMembersLoading(false);
      }
    },
    [groupId, tournament.id],
  );

  useEffect(() => {
    if (!addOpen) return;
    const id = window.setTimeout(() => {
      void fetchMembers(addQuery);
    }, 200);
    return () => window.clearTimeout(id);
  }, [addOpen, addQuery, fetchMembers]);

  const addPlayer = (userId: string): Promise<void> =>
    run(async () => {
      setAddBusy(true);
      try {
        await api(`/api/tournaments/${tournament.id}/admin/registrations`, {
          method: "POST",
          body: { userId },
        });
        await fetchMembers(addQuery);
      } finally {
        setAddBusy(false);
      }
    });

  // ── Pair modal ───────────────────────────────────────────────────────
  const lastPairKey = `lastAdminPair_${tournament.id}`;
  const [pairOpen, setPairOpen] = useState(false);
  const [pairA, setPairA] = useState<string | null>(null);
  const [pairB, setPairB] = useState<string | null>(null);
  const candidatesForPair = unpaired;
  const openPairModal = (): void => {
    let restoredA: string | null = null;
    let restoredB: string | null = null;
    try {
      const raw = window.localStorage.getItem(lastPairKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { a?: unknown; b?: unknown };
        const a = typeof parsed.a === "string" ? parsed.a : null;
        const b = typeof parsed.b === "string" ? parsed.b : null;
        const stillUnpaired = (id: string | null): boolean =>
          !!id && unpaired.some((r) => r.userId === id);
        if (stillUnpaired(a)) restoredA = a;
        if (stillUnpaired(b) && b !== restoredA) restoredB = b;
      }
    } catch {
      // ignore malformed value
    }
    setPairA(restoredA);
    setPairB(restoredB);
    setPairOpen(true);
  };
  const submitPair = (): Promise<void> =>
    run(async () => {
      if (!pairA || !pairB || pairA === pairB) return;
      await api(`/api/tournaments/${tournament.id}/admin/teams`, {
        method: "POST",
        body: { userIdA: pairA, userIdB: pairB },
      });
      try {
        window.localStorage.setItem(
          lastPairKey,
          JSON.stringify({ a: pairA, b: pairB }),
        );
      } catch {
        // ignore storage failures (quota / private mode)
      }
      setPairOpen(false);
      setPairA(null);
      setPairB(null);
    });

  // ── Courts modal ─────────────────────────────────────────────────────
  const [courtPickFor, setCourtPickFor] = useState<string | null>(null);
  const saveCourts = useCallback(
    async (next: Map<string, string[]>): Promise<void> => {
      const assignments = Array.from(next.entries()).map(
        ([courtId, teamIds]) => ({
          courtId,
          teamIds,
        }),
      );
      await run(async () => {
        await api(`/api/tournaments/${tournament.id}/courts`, {
          method: "PUT",
          body: { assignments },
          idempotencyKey: `courts-${tournament.id}-${crypto.randomUUID()}`,
        });
      });
    },
    [run, tournament.id],
  );

  const assignTeamToCourt = (
    courtId: string,
    teamId: string,
  ): Promise<void> => {
    const next = new Map(courtAssignments);
    // remove team from any other court
    for (const [cid, ids] of next.entries()) {
      next.set(
        cid,
        ids.filter((id) => id !== teamId),
      );
    }
    const cur = next.get(courtId) ?? [];
    next.set(courtId, [...cur, teamId]);
    setCourtPickFor(null);
    return saveCourts(next);
  };

  const unassignTeamFromCourt = (
    courtId: string,
    teamId: string,
  ): Promise<void> => {
    const next = new Map(courtAssignments);
    const cur = next.get(courtId) ?? [];
    next.set(
      courtId,
      cur.filter((id) => id !== teamId),
    );
    return saveCourts(next);
  };

  const teamLabel = (team: TeamDoc): string =>
    team.players.map((p) => p.firstName).join(" + ");

  return (
    <Stack gap="md">
      {/* Hero */}
      <Card variant="hero">
        <Inline gap="sm" align="center">
          <Badge variant={isReview ? "warning" : "info"}>
            {t(`tournament.status.${status}`)}
          </Badge>
          <strong>{tournament.name}</strong>
        </Inline>
        <p style={{ margin: "8px 0 0", opacity: 0.8 }}>
          {t("tournament.counts", {
            playing: regs.length,
            bbq: current.counts.bbq,
          })}
        </p>
      </Card>

      {error ? (
        <Card>
          <span style={{ color: "var(--danger, #c00)" }}>
            {t(`errors.${error}`, t("app.errorGeneric"))}
          </span>
        </Card>
      ) : null}

      {/* SECTION 1 — Players */}
      <Card>
        <Inline gap="sm" align="center" wrap>
          <SectionTitle>{t("admin.players.title")}</SectionTitle>
          <span style={{ marginLeft: "auto" }} />
          <Button
            size="sm"
            variant="primary"
            onClick={() => setAddOpen(true)}
            disabled={busy}
          >
            <Plus size={16} /> {t("admin.players.add")}
          </Button>
        </Inline>
        <Stack gap="xs">
          {regs.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={t("admin.players.empty")}
              body=""
            />
          ) : (
            regs.map((r) => {
              const team = playerToTeam.get(r.userId);
              const addedByAdmin = !!r.addedByAdminUserId;
              return (
                <ListRow
                  key={r.userId}
                  leading={<Avatar id={r.userId} name={fullName(r)} />}
                  primary={
                    addedByAdmin ? (
                      <Inline gap="xs" align="center" wrap>
                        <span>{fullName(r)}</span>
                        <Badge variant="warning">
                          {t("admin.players.addedByAdmin")}
                        </Badge>
                      </Inline>
                    ) : (
                      fullName(r)
                    )
                  }
                  secondary={
                    team
                      ? `${t("admin.teams.title")}: ${teamLabel(team)}`
                      : t("admin.teams.unpaired")
                  }
                  trailing={
                    <IconButton
                      aria-label={t("admin.players.remove")}
                      onClick={() => void removeRegistration(r)}
                      disabled={busy}
                      icon={<X size={16} />}
                    />
                  }
                />
              );
            })
          )}
          {resignedRegs.length > 0 ? (
            <>
              <SectionTitle>{t("admin.players.resigned")}</SectionTitle>
              {resignedRegs.map((r) => (
                <ListRow
                  key={r.userId}
                  leading={<Avatar id={r.userId} name={fullName(r)} />}
                  primary={fullName(r)}
                  secondary={t("admin.players.resigned")}
                  trailing={
                    <IconButton
                      aria-label={t("admin.players.unlock")}
                      onClick={() => void unlockRegistration(r)}
                      disabled={busy}
                      icon={<Unlock size={16} />}
                    />
                  }
                />
              ))}
            </>
          ) : null}
        </Stack>
      </Card>

      {/* SECTION 2 — Teams */}
      <Card>
        <Inline gap="sm" align="center" wrap>
          <SectionTitle>{t("admin.teams.title")}</SectionTitle>
          <span style={{ marginLeft: "auto" }} />
          <Button
            size="sm"
            variant="secondary"
            onClick={openPairModal}
            disabled={busy || unpaired.length < 2}
          >
            <UserPlus size={16} /> {t("admin.teams.assign")}
          </Button>
        </Inline>
        <Stack gap="xs">
          {teams.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={t("admin.teams.unpaired")}
              body=""
            />
          ) : (
            teams.map((team) => (
              <ListRow
                key={team.id}
                primary={teamLabel(team)}
                secondary={
                  team.confirmedByAdmin ? (
                    <Badge variant="success">
                      {t("admin.teams.lockedBadge")}
                    </Badge>
                  ) : null
                }
                trailing={
                  <Inline gap="xs">
                    <IconButton
                      aria-label={
                        team.confirmedByAdmin
                          ? t("admin.teams.unconfirm")
                          : t("admin.teams.confirm")
                      }
                      onClick={() => void toggleConfirm(team)}
                      disabled={busy}
                      icon={
                        team.confirmedByAdmin ? (
                          <X size={16} />
                        ) : (
                          <Check size={16} />
                        )
                      }
                    />
                    <IconButton
                      aria-label={t("admin.teams.disband")}
                      onClick={() => void disbandTeam(team)}
                      disabled={busy}
                      icon={<Trash2 size={16} />}
                    />
                  </Inline>
                }
              />
            ))
          )}
        </Stack>
      </Card>

      {/* SECTION 3 — Courts (review only) */}
      {isReview ? (
        <Card>
          <SectionTitle>{t("admin.courts.title")}</SectionTitle>
          <Stack gap="sm">
            {courts.length === 0 ? (
              <EmptyState
                icon={<RefreshCw />}
                title={t("admin.courts.empty")}
                body=""
              />
            ) : (
              courts.map((court) => {
                const ids = courtAssignments.get(court.id) ?? [];
                const assignedTeams = ids
                  .map((id) => teams.find((t) => t.id === id))
                  .filter((t): t is TeamDoc => !!t);
                return (
                  <div
                    key={court.id}
                    style={{
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid var(--tg-theme-hint-color, #ccc)",
                      borderLeftWidth: 4,
                      borderLeftColor:
                        court.color === "green" ? "#22c55e" : "#3b82f6",
                    }}
                  >
                    <Inline gap="sm" align="center" wrap>
                      <strong>{court.label}</strong>
                      <Badge
                        variant={court.color === "green" ? "success" : "info"}
                      >
                        {t(`admin.courts.${court.color}`)}
                      </Badge>
                      <span style={{ marginLeft: "auto" }} />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCourtPickFor(court.id)}
                        disabled={busy}
                      >
                        <Plus size={14} /> {t("admin.courts.assign")}
                      </Button>
                    </Inline>
                    {assignedTeams.length === 0 ? (
                      <p style={{ margin: "6px 0 0", opacity: 0.7 }}>
                        {t("admin.courts.empty")}
                      </p>
                    ) : (
                      <Stack gap="xs">
                        {assignedTeams.map((tm) => (
                          <ListRow
                            key={tm.id}
                            primary={teamLabel(tm)}
                            trailing={
                              <IconButton
                                aria-label={t("admin.players.remove")}
                                onClick={() =>
                                  void unassignTeamFromCourt(court.id, tm.id)
                                }
                                disabled={busy}
                                icon={<X size={16} />}
                              />
                            }
                          />
                        ))}
                      </Stack>
                    )}
                  </div>
                );
              })
            )}
          </Stack>
        </Card>
      ) : null}

      {/* Start blockers */}
      {isReview ? (
        <Card>
          <Stack gap="xs">
            {oddCount ? (
              <p style={{ margin: 0 }}>
                ⚠️ {t("admin.start.blocked.oddCount", { n: regs.length })}
              </p>
            ) : null}
            {unconfirmedCount > 0 ? (
              <p style={{ margin: 0 }}>
                ⚠️{" "}
                {t("admin.start.blocked.notConfirmed", { n: unconfirmedCount })}
              </p>
            ) : null}
            {!courtsAssigned ? (
              <p style={{ margin: 0 }}>
                ⚠️ {t("admin.start.blocked.courtsMissing")}
              </p>
            ) : null}
          </Stack>
        </Card>
      ) : null}

      {/* Sticky bottom bar */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "var(--tg-theme-bg-color, #fff)",
          padding: "8px 0",
          borderTop: "1px solid var(--tg-theme-hint-color, #eee)",
        }}
      >
        {status === "registration_open" ? (
          <Button
            variant="primary"
            onClick={() => void stopRegistration()}
            disabled={busy}
            fullWidth
          >
            {t("tournament.stopRegistration")}
          </Button>
        ) : isReview ? (
          <Inline gap="sm">
            <Button
              variant="ghost"
              onClick={() => void reopenRegistration()}
              disabled={busy}
            >
              {t("tournament.reopenRegistration")}
            </Button>
            <span style={{ marginLeft: "auto" }} />
            <Button
              variant="primary"
              onClick={() => void startTournament()}
              disabled={busy || !canStart}
            >
              {t("tournament.start")}
            </Button>
          </Inline>
        ) : null}
      </div>

      {/* Add player modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t("admin.players.add")}
      >
        <Stack gap="sm">
          <Inline gap="xs" align="center">
            <Search size={16} />
            <input
              type="search"
              inputMode="search"
              placeholder={t("admin.players.search")}
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              style={{
                flex: 1,
                padding: "8px 10px",
                border: "1px solid var(--tg-theme-hint-color, #ccc)",
                borderRadius: 8,
                background: "var(--tg-theme-bg-color, #fff)",
                color: "var(--tg-theme-text-color, #000)",
              }}
            />
          </Inline>
          {membersLoading ? <Spinner /> : null}
          <Stack gap="xs">
            {(() => {
              const addable = members.filter((m) => !m.alreadyRegistered);
              if (addable.length === 0 && !membersLoading) {
                return (
                  <EmptyState
                    icon={<Users />}
                    title={t("admin.players.empty")}
                    body=""
                  />
                );
              }
              return addable.map((m) => (
                <ListRow
                  key={m.userId}
                  leading={<Avatar id={m.userId} name={fullName(m)} />}
                  primary={fullName(m)}
                  trailing={
                    <IconButton
                      aria-label={t("admin.players.add")}
                      onClick={() => void addPlayer(m.userId)}
                      disabled={busy || addBusy}
                      icon={<Plus size={16} />}
                    />
                  }
                />
              ));
            })()}
          </Stack>
        </Stack>
      </Modal>

      {/* Pair modal */}
      <Modal
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        title={t("admin.teams.assign")}
      >
        <Stack gap="sm">
          <div>
            <SectionTitle>{t("admin.teams.pickA")}</SectionTitle>
            <Inline gap="xs" wrap>
              {candidatesForPair.map((r) => (
                <ToggleChip
                  key={r.userId}
                  checked={pairA === r.userId}
                  onClick={() => setPairA(r.userId)}
                >
                  {fullName(r)}
                </ToggleChip>
              ))}
            </Inline>
          </div>
          <div>
            <SectionTitle>{t("admin.teams.pickB")}</SectionTitle>
            <Inline gap="xs" wrap>
              {candidatesForPair
                .filter((r) => r.userId !== pairA)
                .map((r) => (
                  <ToggleChip
                    key={r.userId}
                    checked={pairB === r.userId}
                    onClick={() => setPairB(r.userId)}
                  >
                    {fullName(r)}
                  </ToggleChip>
                ))}
            </Inline>
          </div>
          <Button
            variant="primary"
            onClick={() => void submitPair()}
            disabled={!pairA || !pairB || busy}
            fullWidth
          >
            {t("admin.teams.confirm")}
          </Button>
        </Stack>
      </Modal>

      {/* Court picker modal */}
      <Modal
        open={courtPickFor !== null}
        onClose={() => setCourtPickFor(null)}
        title={t("admin.courts.assign")}
      >
        <Stack gap="xs">
          {teams.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={t("admin.teams.unpaired")}
              body=""
            />
          ) : (
            teams.map((tm) => {
              const isAssigned = assignedTeamIds.has(tm.id);
              return (
                <ListRow
                  key={tm.id}
                  primary={teamLabel(tm)}
                  secondary={
                    isAssigned ? (
                      <Badge variant="neutral">
                        {t("admin.courts.unassigned")}
                      </Badge>
                    ) : null
                  }
                  interactive
                  onClick={() => {
                    if (courtPickFor) {
                      void assignTeamToCourt(courtPickFor, tm.id);
                    }
                  }}
                />
              );
            })
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
