import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface User {
  id: string;
  email: string | null;
  name: string;
  role: 'admin' | 'user' | 'visitor';
  isGuest: boolean;
}

/** Conta criada que ainda não usou um código de acesso. */
export interface AwaitingToken { email: string | null; name: string }

interface AuthState {
  user: User | null;
  awaitingToken: AwaitingToken | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  user: null, awaitingToken: null, loading: true, refresh: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: User | null; awaitingToken?: AwaitingToken }>('/api/auth/me'), staleTime: 60_000 });
  const refresh = async () => { await qc.invalidateQueries(); };
  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    await qc.invalidateQueries({ queryKey: ['me'] });
  };
  return <Ctx.Provider value={{ user: q.data?.user ?? null, awaitingToken: q.data?.awaitingToken ?? null, loading: q.isLoading, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
