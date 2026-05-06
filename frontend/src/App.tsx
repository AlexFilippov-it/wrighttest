import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ConfigProvider, theme } from 'antd';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import EnvironmentsPage from './pages/EnvironmentsPage';
import NotificationsPage from './pages/NotificationsPage';
import ProjectPage from './pages/ProjectPage';
import RunsPage from './pages/RunsPage';
import SchedulesPage from './pages/SchedulesPage';
import ScheduleHistoryPage from './pages/ScheduleHistoryPage';
import SuitesPage from './pages/SuitesPage';
import TestEditorPage from './pages/TestEditorPage';
import RunResultPage from './pages/RunResultPage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth();

  if (!ready) {
    return null;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <Routes>
                    <Route path="/" element={<Navigate to="/projects" replace />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/runs" element={<RunsPage />} />
                    <Route path="/projects" element={<ProjectsPage />} />
                    <Route path="/projects/:projectId" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/checks" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/overview" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/runs" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/settings" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/environments" element={<EnvironmentsPage />} />
                    <Route path="/projects/:projectId/notifications" element={<NotificationsPage />} />
                    <Route path="/projects/:projectId/suites" element={<SuitesPage />} />
                    <Route path="/projects/:projectId/schedules" element={<SchedulesPage />} />
                    <Route path="/schedules/:scheduleId/history" element={<ScheduleHistoryPage />} />
                    <Route path="/projects/:projectId/tests/new" element={<TestEditorPage />} />
                    <Route path="/tests/:testId/edit" element={<TestEditorPage />} />
                    <Route path="/runs/:runId" element={<RunResultPage />} />
                  </Routes>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </ConfigProvider>
    </AuthProvider>
  );
}
