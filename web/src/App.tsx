import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { ExamsPage } from './pages/Exams';
import { PlannerPage } from './pages/Planner';
import { ReviewsPage } from './pages/Reviews';
import { PerformancePage } from './pages/Performance';
import { SettingsPage } from './pages/Settings';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminInstitutions, AdminBoards } from './pages/admin/AdminCatalog';
import { AdminExams } from './pages/admin/AdminExams';
import { AdminEditions, AdminEditionDetail } from './pages/admin/AdminEditions';
import { AdminSubjects } from './pages/admin/AdminSubjects';
import { AdminStats } from './pages/admin/AdminStats';
import { AdminImport } from './pages/admin/AdminImport';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminLogs } from './pages/admin/AdminLogs';
import { AdminSettings } from './pages/admin/AdminSettings';
import { AdminNewExam } from './pages/admin/AdminNewExam';
import { Forbidden } from './pages/Forbidden';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Forbidden />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="provas" element={<ExamsPage />} />
        <Route path="planner" element={<PlannerPage />} />
        <Route path="revisoes" element={<ReviewsPage />} />
        <Route path="desempenho" element={<PerformancePage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route index element={<AdminDashboard />} />
          <Route path="nova-prova" element={<AdminNewExam />} />
          <Route path="instituicoes" element={<AdminInstitutions />} />
          <Route path="bancas" element={<AdminBoards />} />
          <Route path="provas" element={<AdminExams />} />
          <Route path="edicoes" element={<AdminEditions />} />
          <Route path="edicoes/:id" element={<AdminEditionDetail />} />
          <Route path="assuntos" element={<AdminSubjects />} />
          <Route path="estatisticas" element={<AdminStats />} />
          <Route path="importacao" element={<AdminImport />} />
          <Route path="usuarios" element={<AdminUsers />} />
          <Route path="logs" element={<AdminLogs />} />
          <Route path="configuracoes" element={<AdminSettings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
