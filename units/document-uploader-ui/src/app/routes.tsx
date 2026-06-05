import { createBrowserRouter, Navigate } from 'react-router';
import { DashboardLayout } from './components/layout/dashboard-layout';
import { AdminConfig } from './components/admin-config';
import { UploadWizard } from './components/upload-wizard';
import { Documents } from './pages/documents';
import { Login } from './pages/login';
import { Monitor } from './pages/monitor';
import { MonitorClassic } from './pages/monitor-classic';
import { Workspaces } from './pages/workspaces';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Login,
  },
  {
    path: '/login',
    Component: Login,
  },
  {
    Component: DashboardLayout,
    children: [
      {
        path: '/workspaces',
        Component: Workspaces,
      },
      {
        path: '/document-transfer',
        Component: UploadWizard,
      },
      {
        path: '/documents',
        Component: Documents,
      },
      {
        path: '/monitor',
        Component: Monitor,
      },
      {
        path: '/admin',
        Component: AdminConfig,
      },
    ],
  },
  {
    // Classic dark "technical dashboard" monitor — standalone (full-bleed dark,
    // its own back link), intentionally OUTSIDE DashboardLayout so the dark shell
    // isn't framed by the light sidebar chrome.
    path: '/monitor-classic',
    Component: MonitorClassic,
  },
  {
    // Catch-all: unknown paths (e.g. the retired /monitor deep links, typos)
    // redirect to Workspaces instead of rendering a blank page.
    path: '*',
    element: <Navigate to="/workspaces" replace />,
  },
]);
