import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; name: string; email: string; cro: string | null };
  mfa: { required: boolean; verified: boolean; enabled: boolean; trustedDevices: number };
  pendingLegal: { id: string; kind: string; version: number; title: string }[];
  clinics: { id: string; name: string; role: string; billingStatus: string; city: string | null }[];
  current: { clinicId: string; role: string; permissions: string[]; billingStatus: string } | null;
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/auth/me'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
      else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('fichaclin:auth-changed', onChange);
    return () => window.removeEventListener('fichaclin:auth-changed', onChange);
  }, [refresh]);

  const can = useCallback((perm: string) => Boolean(me?.current?.permissions.includes(perm)), [me]);

  return <Ctx.Provider value={{ me, loading, refresh, can }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession fora do SessionProvider');
  return v;
}
