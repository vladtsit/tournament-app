// Typed wrapper around `window.Telegram.WebApp`. Components should import from
// here rather than touching `window.Telegram` directly (spec §7.1).

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface TelegramInitDataUnsafe {
  user?: TelegramUser;
  start_param?: string;
  chat_instance?: string;
  chat_type?: string;
  query_id?: string;
  auth_date?: number;
  hash?: string;
}

export interface CloudStorage {
  setItem(
    key: string,
    value: string,
    cb?: (err: string | null, ok?: boolean) => void,
  ): void;
  getItem(key: string, cb: (err: string | null, value?: string) => void): void;
  removeItem(
    key: string,
    cb?: (err: string | null, ok?: boolean) => void,
  ): void;
}

export interface HapticFeedback {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
  selectionChanged(): void;
}

export interface MainButton {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  setText(text: string): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
}

export interface BackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: TelegramInitDataUnsafe;
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  ready(): void;
  expand(): void;
  close(): void;
  MainButton: MainButton;
  BackButton: BackButton;
  HapticFeedback: HapticFeedback;
  CloudStorage: CloudStorage;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function getWebApp(): TelegramWebApp | undefined {
  return typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
}

export function isInTelegram(): boolean {
  const wa = getWebApp();
  // `initData` is empty when the page is loaded outside Telegram, even though
  // the script tag may have created the WebApp object.
  return !!wa && typeof wa.initData === "string" && wa.initData.length > 0;
}

/** Promise-wrapped CloudStorage with localStorage fallback. */
export const storage = {
  async get(key: string): Promise<string | null> {
    const wa = getWebApp();
    if (wa?.CloudStorage) {
      return await new Promise((resolve) => {
        wa.CloudStorage.getItem(key, (err, value) => {
          if (err) resolve(null);
          else resolve(value ?? null);
        });
      });
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    const wa = getWebApp();
    if (wa?.CloudStorage) {
      await new Promise<void>((resolve) => {
        wa.CloudStorage.setItem(key, value, () => resolve());
      });
      return;
    }
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};

/** Telegram HapticFeedback helpers — safe no-op outside Telegram. */
export const haptic = {
  impact(
    style: "light" | "medium" | "heavy" | "rigid" | "soft" = "light",
  ): void {
    try {
      getWebApp()?.HapticFeedback?.impactOccurred(style);
    } catch {
      // ignore
    }
  },
  notify(type: "success" | "warning" | "error"): void {
    try {
      getWebApp()?.HapticFeedback?.notificationOccurred(type);
    } catch {
      // ignore
    }
  },
  selection(): void {
    try {
      getWebApp()?.HapticFeedback?.selectionChanged();
    } catch {
      // ignore
    }
  },
};

/**
 * Propagate the current Telegram color scheme onto the root element so the
 * design-token stylesheet can switch between light and dark variants
 * (`[data-tg-color-scheme="dark"]`). Subscribes to `themeChanged` so toggling
 * the system theme inside Telegram is reflected live.
 *
 * Safe to call multiple times; safe outside Telegram (defaults to light).
 */
export function applyTelegramColorScheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const wa = getWebApp();
  const apply = (): void => {
    const scheme = wa?.colorScheme ?? "light";
    root.dataset["tgColorScheme"] = scheme;
  };
  apply();
  if (wa?.onEvent) {
    try {
      wa.onEvent("themeChanged", apply);
    } catch {
      // ignore — older Telegram clients may not expose onEvent
    }
  }
}
