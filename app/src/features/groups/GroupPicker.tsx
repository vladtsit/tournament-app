import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Shield, Users } from "lucide-react";
import type { AuthGroup } from "../../hooks/useTelegramAuth";
import { Badge, Card, Inline, ListRow, SectionTitle, Stack } from "../../ui";

interface Props {
  groups: AuthGroup[];
  onSelect: (groupId: string) => Promise<void> | void;
}

export function GroupPicker({ groups, onSelect }: Props): JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <Card>
      <Stack gap="md">
        <Stack gap="xs">
          <SectionTitle>{t("groupPicker.title")}</SectionTitle>
          <p
            style={{
              fontSize: "var(--font-sm)",
              color: "var(--text-muted)",
            }}
          >
            {t("groupPicker.subtitle")}
          </p>
        </Stack>
        <Stack gap="xs">
          {groups.map((g) => (
            <ListRow
              key={g.groupId}
              interactive
              bordered
              disabled={busy !== null}
              onClick={async () => {
                setBusy(g.groupId);
                try {
                  await onSelect(g.groupId);
                } finally {
                  setBusy(null);
                }
              }}
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
                    background:
                      "color-mix(in srgb, var(--accent) 12%, transparent)",
                    color: "var(--accent)",
                  }}
                >
                  <Users size={18} />
                </span>
              }
              primary={
                <Inline gap="sm" align="center" wrap>
                  <span>{g.title}</span>
                  {g.isAdmin ? (
                    <Badge variant="info" size="sm">
                      <Inline gap="xs" align="center">
                        <Shield size={11} />
                        {t("groupPicker.admin")}
                      </Inline>
                    </Badge>
                  ) : null}
                </Inline>
              }
              trailing={<ChevronRight size={18} color="var(--text-muted)" />}
            />
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
