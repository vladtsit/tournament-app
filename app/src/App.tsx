import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";
import { useTelegramAuth } from "./hooks/useTelegramAuth";
import { useBackButton } from "./hooks/useBackButton";
import { haptic, storage } from "./telegram";
import { setLanguage } from "./i18n";
import {
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "./i18n/resolveLocale";
import { GroupPicker } from "./features/groups/GroupPicker";
import { TournamentScreen } from "./features/tournament/TournamentScreen";
import { HistoryScreen } from "./features/history/HistoryScreen";
import { OverallScreen } from "./features/history/OverallScreen";

export function App(): JSX.Element {
  const { t, i18n } = useTranslation();
  const auth = useTelegramAuth();

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        padding: 16,
        maxWidth: 480,
        margin: "0 auto",
        color: "var(--tg-theme-text-color, inherit)",
        background: "var(--tg-theme-bg-color, transparent)",
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>{t("app.title")}</h1>
        <LanguagePicker current={i18n.language as SupportedLanguage} />
      </header>

      <section style={{ marginTop: 24 }}>
        {auth.status === "idle" && <p>…</p>}
        {auth.status === "authenticating" && <p>{t("app.authenticating")}</p>}
        {auth.status === "not_in_telegram" && (
          <p>{t("app.openFromTelegram")}</p>
        )}
        {auth.status === "error" && (
          <p>
            {t(`errors.${auth.errorCode ?? "errorGeneric"}` as const, {
              defaultValue: t("app.errorGeneric"),
            })}
          </p>
        )}
        {auth.status === "picking_group" && (
          <GroupPicker groups={auth.groups} onSelect={auth.selectGroup} />
        )}
        {auth.status === "authenticated" && auth.user && (
          <>
            <p>{t("auth.welcome", { name: auth.user.firstName })}</p>
            {auth.group && (
              <>
                <p style={{ fontSize: 13, opacity: 0.8 }}>
                  {t("groupPicker.activeGroup", { title: auth.group.title })}
                </p>
                <div style={{ marginTop: 16 }}>
                  <TabbedView isAdmin={auth.group.isAdmin} />
                </div>
              </>
            )}
            {!auth.group && auth.groups.length === 0 && (
              <p style={{ fontSize: 13, opacity: 0.8 }}>
                {t("groupPicker.noGroups")}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}

type Tab = "current" | "history" | "overall";

const TAB_STORAGE_KEY = "lastTab";
const TABS: readonly Tab[] = ["current", "history", "overall"] as const;

function TabbedView({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("current");

  // Restore last-used tab from CloudStorage (falls back to localStorage).
  useEffect(() => {
    let cancelled = false;
    void storage.get(TAB_STORAGE_KEY).then((v) => {
      if (cancelled) return;
      if (v && (TABS as readonly string[]).includes(v)) {
        setTab(v as Tab);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectTab = useCallback((id: Tab) => {
    haptic.selection();
    setTab(id);
    void storage.set(TAB_STORAGE_KEY, id);
  }, []);

  const goCurrent = useCallback(() => selectTab("current"), [selectTab]);
  useBackButton(tab !== "current", goCurrent);

  return (
    <div>
      <nav
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 12,
          borderBottom:
            "1px solid var(--tg-theme-section-separator-color, #e5e5e5)",
        }}
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTab(id)}
            style={{
              padding: "8px 12px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: tab === id ? 600 : 400,
              borderBottom:
                tab === id
                  ? "2px solid var(--tg-theme-button-color, #2ea6ff)"
                  : "2px solid transparent",
              color: "inherit",
            }}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </nav>
      {tab === "current" && <TournamentScreen isAdmin={isAdmin} />}
      {tab === "history" && <HistoryScreen />}
      {tab === "overall" && <OverallScreen />}
    </div>
  );
}

function LanguagePicker({
  current,
}: {
  current: SupportedLanguage;
}): JSX.Element {
  const { t } = useTranslation();
  const labels: Record<SupportedLanguage, string> = {
    en: t("common.english"),
    es: t("common.spanish"),
    ru: t("common.russian"),
  };
  return (
    <label style={{ fontSize: 12, opacity: 0.8 }}>
      <span style={{ marginRight: 4 }}>{t("common.language")}:</span>
      <select
        value={current}
        onChange={(e) => {
          void setLanguage(e.target.value as SupportedLanguage);
        }}
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {labels[lng]}
          </option>
        ))}
      </select>
    </label>
  );
}
