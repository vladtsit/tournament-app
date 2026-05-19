import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiClientError,
  setReauthHandler,
  setSessionToken,
} from "../apiClient";
import { getWebApp, isInTelegram } from "../telegram";

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  language: string;
  photoUrl: string | null;
}

export interface AuthGroup {
  groupId: string;
  groupShortId: string;
  title: string;
  isAdmin: boolean;
}

export type AuthStatus =
  | "idle"
  | "authenticating"
  | "authenticated"
  | "picking_group"
  | "error"
  | "not_in_telegram";

export interface AuthState {
  status: AuthStatus;
  user?: AuthUser;
  group?: AuthGroup | null;
  groups: AuthGroup[];
  errorCode?: string;
  /** Re-run /api/auth/telegram with an explicit `groupId` selection. */
  selectGroup: (groupId: string) => Promise<void>;
}

interface AuthResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
  startParam: string | null;
  groupId: string | null;
  group: { groupId: string; groupShortId: string; title: string } | null;
  groups: AuthGroup[];
}

interface InternalState {
  status: AuthStatus;
  user?: AuthUser;
  group?: AuthGroup | null;
  groups: AuthGroup[];
  errorCode?: string;
}

export function useTelegramAuth(): AuthState {
  const [state, setState] = useState<InternalState>({
    status: "idle",
    groups: [],
  });
  // Remember the most recently picked group so a silent re-auth (after a 401
  // when the JWT expires mid-session) lands the user back on the same group.
  const lastGroupIdRef = useRef<string | undefined>(undefined);

  const authenticate = useCallback(async (groupId?: string): Promise<void> => {
    const wa = getWebApp();
    if (!wa) return;
    setState((s) => ({ ...s, status: "authenticating" }));
    try {
      const res = await api<AuthResponse>("/api/auth/telegram", {
        method: "POST",
        body: groupId
          ? { initData: wa.initData, groupId }
          : { initData: wa.initData },
      });
      setSessionToken(res.token);
      if (res.groupId) lastGroupIdRef.current = res.groupId;
      const group: AuthGroup | null = res.group
        ? {
            ...res.group,
            isAdmin:
              res.groups.find((g) => g.groupId === res.group!.groupId)
                ?.isAdmin ?? false,
          }
        : null;
      const nextStatus: AuthStatus = res.groupId
        ? "authenticated"
        : res.groups.length > 1
          ? "picking_group"
          : "authenticated";
      setState({
        status: nextStatus,
        user: res.user,
        group,
        groups: res.groups,
      });
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : "unknown";
      setState({ status: "error", errorCode: code, groups: [] });
    }
  }, []);

  // Silent reauth path used by apiClient when a request returns 401. Runs
  // the Telegram handshake again and resolves with the new token (or null on
  // failure) so the original request can be retried once.
  useEffect(() => {
    setReauthHandler(async () => {
      const wa = getWebApp();
      if (!wa) return null;
      try {
        const body = lastGroupIdRef.current
          ? { initData: wa.initData, groupId: lastGroupIdRef.current }
          : { initData: wa.initData };
        const res = await api<AuthResponse>("/api/auth/telegram", {
          method: "POST",
          body,
        });
        setSessionToken(res.token);
        if (res.groupId) lastGroupIdRef.current = res.groupId;
        return res.token;
      } catch {
        return null;
      }
    });
    return () => setReauthHandler(null);
  }, []);

  useEffect(() => {
    const wa = getWebApp();
    wa?.ready();
    if (!isInTelegram()) {
      setState({ status: "not_in_telegram", groups: [] });
      return;
    }
    void authenticate();
  }, [authenticate]);

  return useMemo<AuthState>(
    () => ({ ...state, selectGroup: authenticate }),
    [state, authenticate],
  );
}
