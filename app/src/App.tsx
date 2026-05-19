import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, HelpCircle, History, Trophy } from "lucide-react";
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
import { HelpScreen } from "./features/help/HelpScreen";
import { Avatar, IconButton, LanguagePicker, Spinner, Stack } from "./ui";
import styles from "./App.module.css";

export function App(): JSX.Element {
  const { t, i18n } = useTranslation();
  const auth = useTelegramAuth();
  const [showHelp, setShowHelp] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const languageOptions = SUPPORTED_LANGUAGES.map((lng) => ({
    value: lng,
    label: t(
      `common.${
        lng === "en" ? "english" : lng === "es" ? "spanish" : "russian"
      }`,
    ),
  }));

  return (
    <main className={styles["shell"]}>
      <header
        className={[
          styles["header"],
          scrolled ? styles["headerScrolled"] : null,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <h1 className={styles["title"]}>{t("app.title")}</h1>
        <div className={styles["headerActions"]}>
          <LanguagePicker
            current={i18n.language as SupportedLanguage}
            options={languageOptions}
            label={t("common.language")}
            onSelect={(lng) => {
              haptic.selection();
              void setLanguage(lng);
            }}
          />
          <IconButton
            icon={<HelpCircle size={20} />}
            aria-label={t("help.title")}
            size="sm"
            variant="flat"
            onClick={() => {
              haptic.selection();
              setShowHelp(true);
            }}
          />
        </div>
      </header>

      <HelpScreen open={showHelp} onClose={() => setShowHelp(false)} />

      <div className={styles["content"]}>
        {auth.status === "idle" || auth.status === "authenticating" ? (
          <div className={styles["statusCenter"]}>
            <Spinner size={28} label={t("app.authenticating")} />
            <span>{t("app.authenticating")}</span>
          </div>
        ) : null}

        {auth.status === "not_in_telegram" ? (
          <div className={styles["statusCenter"]}>
            <span>{t("app.openFromTelegram")}</span>
          </div>
        ) : null}

        {auth.status === "error" ? (
          <div className={styles["statusCenter"]}>
            <span style={{ color: "var(--danger)" }}>
              {t(`errors.${auth.errorCode ?? "errorGeneric"}` as const, {
                defaultValue: t("app.errorGeneric"),
              })}
            </span>
          </div>
        ) : null}

        {auth.status === "picking_group" ? (
          <GroupPicker groups={auth.groups} onSelect={auth.selectGroup} />
        ) : null}

        {auth.status === "authenticated" && auth.user ? (
          <Stack gap="md">
            <div className={styles["welcome"]}>
              <Avatar
                id={auth.user.id}
                name={`${auth.user.firstName} ${auth.user.lastName ?? ""}`.trim()}
                size={40}
              />
              <div className={styles["welcomeText"]}>
                <span className={styles["welcomeName"]}>
                  {t("auth.welcome", { name: auth.user.firstName })}
                </span>
                {auth.group ? (
                  <span className={styles["welcomeGroup"]}>
                    {t("groupPicker.activeGroup", { title: auth.group.title })}
                  </span>
                ) : null}
              </div>
            </div>
            {auth.group ? (
              <TabbedView
                isAdmin={auth.group.isAdmin}
                groupId={auth.group.groupId}
              />
            ) : auth.groups.length === 0 ? (
              <div className={styles["statusCenter"]}>
                <span>{t("groupPicker.noGroups")}</span>
              </div>
            ) : null}
          </Stack>
        ) : null}
      </div>
    </main>
  );
}

type Tab = "current" | "history" | "overall";

const TAB_STORAGE_KEY = "lastTab";
const TABS: readonly Tab[] = ["current", "history", "overall"] as const;

const TAB_ICON: Record<Tab, JSX.Element> = {
  current: <Trophy size={20} />,
  history: <History size={20} />,
  overall: <BarChart3 size={20} />,
};

function TabbedView({
  isAdmin,
  groupId,
}: {
  isAdmin: boolean;
  groupId: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("current");

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
      <nav className={styles["tabs"]} role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => selectTab(id)}
            className={[styles["tab"], tab === id ? styles["tabActive"] : null]
              .filter(Boolean)
              .join(" ")}
          >
            {TAB_ICON[id]}
            <span>{t(`tabs.${id}`)}</span>
          </button>
        ))}
      </nav>
      {tab === "current" ? (
        <TournamentScreen isAdmin={isAdmin} groupId={groupId} />
      ) : null}
      {tab === "history" ? <HistoryScreen /> : null}
      {tab === "overall" ? <OverallScreen /> : null}
    </div>
  );
}
