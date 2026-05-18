import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthGroup } from "../../hooks/useTelegramAuth";

interface Props {
  groups: AuthGroup[];
  onSelect: (groupId: string) => Promise<void> | void;
}

export function GroupPicker({ groups, onSelect }: Props): JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <section style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 16, margin: "8px 0" }}>
        {t("groupPicker.title")}
      </h2>
      <p style={{ fontSize: 13, opacity: 0.8, margin: "0 0 12px" }}>
        {t("groupPicker.subtitle")}
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {groups.map((g) => (
          <li key={g.groupId} style={{ marginBottom: 8 }}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(g.groupId);
                try {
                  await onSelect(g.groupId);
                } finally {
                  setBusy(null);
                }
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--tg-theme-hint-color, #ccc)",
                background:
                  busy === g.groupId
                    ? "var(--tg-theme-secondary-bg-color, #eee)"
                    : "var(--tg-theme-bg-color, transparent)",
                color: "inherit",
                fontSize: 15,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              <strong>{g.title}</strong>
              {g.isAdmin && (
                <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>
                  · {t("groupPicker.admin")}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
