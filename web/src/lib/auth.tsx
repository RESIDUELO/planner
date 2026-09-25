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

const Ctx = createContext<{ user: User | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> }>({
  user: null, loading: true, refresh: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: User | null }>('/api/auth/me'), staleTime: 60_000 });
  const refresh = async () => { await qc.invalidateQueries(); };
  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    await qc.invalidateQueries({ queryKey: ['me'] });
  };
  return <Ctx.Provider value={{ user: q.data?.user ?? null, loading: q.isLoading, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
