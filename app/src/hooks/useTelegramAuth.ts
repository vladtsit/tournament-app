import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiClientError, setSessionToken } from "../apiClient";
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

  const authenticate = useCallback(
    async (groupId?: string): Promise<void> => {
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
    },
    [],
  );

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
