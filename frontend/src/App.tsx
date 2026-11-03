import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import { wrightTestTheme } from './design-system';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import RunsPage from './pages/RunsPage';
import ScheduleHistoryPage from './pages/ScheduleHistoryPage';
import SuitesPage from './pages/SuitesPage';
import TestEditorPage from './pages/TestEditorPage';
import RunResultPage from './pages/RunResultPage';
import RunBatchResultPage from './pages/RunBatchResultPage';
import AppShell from './shell/AppShell';
import ProjectShell from './shell/ProjectShell';
import NotFoundPage from './shell/NotFoundPage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth();

  if (!ready) return null;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LegacyNotificationsRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/projects/${projectId}/alerts`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <ConfigProvider theme={wrightTestTheme}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="runs" element={<RunsPage />} />
              <Route path="projects" element={<ProjectsPage />} />

              <Route path="projects/:projectId" element={<ProjectShell />}>
                <Route index element={<Navigate to="checks" replace />} />
                <Route path="overview" element={<ProjectPage />} />
                <Route path="checks" element={<ProjectPage />} />
                <Route path="suites" element={<SuitesPage />} />
                <Route path="runs" element={<ProjectPage />} />
                <Route path="schedules" element={<ProjectPage />} />
                <Route path="environments" element={<ProjectPage />} />
                <Route path="authentication" element={<ProjectPage />} />
                <Route path="alerts" element={<ProjectPage />} />
                <Route path="notifications" element={<LegacyNotificationsRedirect />} />
                <Route path="settings" element={<ProjectPage />} />
                <Route path="members" element={<ProjectPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>

              <Route path="schedules/:scheduleId/history" element={<ScheduleHistoryPage />} />
              <Route path="projects/:projectId/tests/new" element={<TestEditorPage />} />
              <Route path="tests/:testId/edit" element={<TestEditorPage />} />
              <Route path="runs/:runId" element={<RunResultPage />} />
              <Route path="run-batches/:batchId" element={<RunBatchResultPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfigProvider>
    </AuthProvider>
  );
}
