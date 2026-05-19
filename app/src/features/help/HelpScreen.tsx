import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Crown,
  Flag,
  Globe,
  Lock,
  Settings,
  Trophy,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";
import { Modal } from "../../ui";
import { useBackButton } from "../../hooks/useBackButton";
import { haptic } from "../../telegram";

interface Props {
  open: boolean;
  onClose: () => void;
}

type SectionKey =
  | "intro"
  | "registration"
  | "teams"
  | "live"
  | "matches"
  | "leaderboard"
  | "history"
  | "overall"
  | "admin"
  | "language"
  | "privacy";

const SECTION_KEYS: SectionKey[] = [
  "intro",
  "registration",
  "teams",
  "live",
  "matches",
  "leaderboard",
  "history",
  "overall",
  "admin",
  "language",
  "privacy",
];

const ICON: Record<SectionKey, JSX.Element> = {
  intro: <BookOpen size={18} />,
  registration: <ClipboardList size={18} />,
  teams: <Users size={18} />,
  live: <Zap size={18} />,
  matches: <Flag size={18} />,
  leaderboard: <Trophy size={18} />,
  history: <Crown size={18} />,
  overall: <UserCheck size={18} />,
  admin: <Settings size={18} />,
  language: <Globe size={18} />,
  privacy: <Lock size={18} />,
};

export function HelpScreen({ open, onClose }: Props): JSX.Element {
  const { t } = useTranslation();
  const [openKey, setOpenKey] = useState<SectionKey>("intro");

  useBackButton(open, onClose);
  useEffect(() => {
    if (open) haptic.selection();
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("help.title")}
      closeLabel={t("common.close")}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {SECTION_KEYS.map((key) => {
          const isOpen = openKey === key;
          return (
            <article
              key={key}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                background: "var(--surface-2)",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => setOpenKey(isOpen ? ("" as SectionKey) : key)}
                aria-expanded={isOpen}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  width: "100%",
                  padding: "var(--space-3) var(--space-4)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text)",
                  font: "inherit",
                  textAlign: "left",
                  minHeight: "var(--tap-min)",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    color: "var(--accent)",
                    display: "inline-flex",
                  }}
                >
                  {ICON[key]}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontWeight: "var(--weight-semibold)",
                    fontSize: "var(--font-md)",
                  }}
                >
                  {t(`help.sections.${key}.title`)}
                </span>
                <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>
                  {isOpen ? (
                    <ChevronUp size={18} />
                  ) : (
                    <ChevronDown size={18} />
                  )}
                </span>
              </button>
              {isOpen ? (
                <div
                  style={{
                    padding: "0 var(--space-4) var(--space-3)",
                    color: "var(--text)",
                    fontSize: "var(--font-sm)",
                    lineHeight: 1.55,
                  }}
                >
                  {t(`help.sections.${key}.body`)}
                </div>
              ) : null}
            </article>
          );
        })}
        <p
          style={{
            marginTop: "var(--space-3)",
            fontSize: "var(--font-sm)",
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          {t("help.footer")}
        </p>
      </div>
    </Modal>
  );
}
