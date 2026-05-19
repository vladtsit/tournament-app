import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useBackButton } from "../../hooks/useBackButton";
import { haptic } from "../../telegram";

interface Props {
  onClose: () => void;
}

const SECTION_KEYS = [
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
] as const;

export function HelpScreen({ onClose }: Props): JSX.Element {
  const { t } = useTranslation();

  useBackButton(true, onClose);
  useEffect(() => {
    haptic.selection();
  }, []);

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
        <h2 style={{ margin: 0 }}>{t("help.title")}</h2>
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
      {SECTION_KEYS.map((key) => (
        <article key={key} style={{ marginBottom: 14 }}>
          <h3 style={{ margin: "0 0 4px 0", fontSize: 16 }}>
            {t(`help.sections.${key}.title`)}
          </h3>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            {t(`help.sections.${key}.body`)}
          </p>
        </article>
      ))}
      <p style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
        {t("help.footer")}
      </p>
    </section>
  );
}
