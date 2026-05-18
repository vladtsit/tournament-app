import { useEffect, useState } from 'react';
import { api, ApiClientError, setSessionToken } from '../apiClient';
import { getWebApp, isInTelegram } from '../telegram';

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  language: string;
  photoUrl: string | null;
}

export interface AuthState {
  status: 'idle' | 'authenticating' | 'authenticated' | 'error' | 'not_in_telegram';
  user?: AuthUser;
  errorCode?: string;
}

interface AuthResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
  startParam: string | null;
}

export function useTelegramAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'idle' });

  useEffect(() => {
    const wa = getWebApp();
    wa?.ready();

    if (!isInTelegram()) {
      setState({ status: 'not_in_telegram' });
      return;
    }

    let cancelled = false;
    setState({ status: 'authenticating' });

    api<AuthResponse>('/api/auth/telegram', {
      method: 'POST',
      body: { initData: wa!.initData },
    })
      .then((res) => {
        if (cancelled) return;
        setSessionToken(res.token);
        setState({ status: 'authenticated', user: res.user });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = err instanceof ApiClientError ? err.code : 'unknown';
        setState({ status: 'error', errorCode: code });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
