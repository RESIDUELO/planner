import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { ExamsPage } from './pages/Exams';
import { PlannerPage } from './pages/Planner';
import { ReviewsPage } from './pages/Reviews';
import { PerformancePage } from './pages/Performance';
import { SettingsPage } from './pages/Settings';
import { FocusPage } from './pages/Focus';
import { AgendaPage } from './pages/Agenda';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/planner" replace />} />
        <Route path="provas" element={<ExamsPage />} />
        <Route path="planner" element={<PlannerPage />} />
        <Route path="agenda" element={<AgendaPage />} />
        <Route path="foco" element={<FocusPage />} />
        <Route path="revisoes" element={<ReviewsPage />} />
        <Route path="desempenho" element={<PerformancePage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
