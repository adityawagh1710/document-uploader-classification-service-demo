import type { NavItemType } from '@opus2-platform/codex';
import {
  Activity,
  File06,
  HomeLine,
  LogOut01,
  Settings01,
  UploadCloud02,
} from '@opus2-platform/icons';

export const mainNavItems: NavItemType[] = [
  { label: 'Workspaces', href: '/workspaces', icon: HomeLine },
  { label: 'Document Transfer', href: '/document-transfer', icon: UploadCloud02 },
  { label: 'Documents', href: '/documents', icon: File06 },
  { label: 'Monitor', href: '/monitor', icon: Activity },
  { label: 'Monitor (classic)', href: '/monitor-classic', icon: Activity },
  { label: 'Admin Config', href: '/admin', icon: Settings01 },
];

export const footerNavItems: NavItemType[] = [
  { label: 'Sign out', href: '/login', icon: LogOut01 },
];

export interface BreadcrumbConfig {
  label: string;
  href?: string;
}

const routeMeta: Record<string, { title: string; description?: string; breadcrumbs: BreadcrumbConfig[] }> = {
  '/workspaces': {
    title: 'Workspaces',
    description: 'Choose a case workspace to access Document Transfer and other tools',
    breadcrumbs: [
      { label: 'Home', href: '/workspaces' },
      { label: 'Workspaces' },
    ],
  },
  '/document-transfer': {
    title: 'Document Transfer',
    description: 'Upload and transfer documents to your workspace',
    breadcrumbs: [
      { label: 'Home', href: '/workspaces' },
      { label: 'Workspaces', href: '/workspaces' },
      { label: 'Document Transfer' },
    ],
  },
  '/documents': {
    title: 'Published Documents',
    description: 'Search and view all documents in this workspace',
    breadcrumbs: [
      { label: 'Home', href: '/workspaces' },
      { label: 'Workspaces', href: '/workspaces' },
      { label: 'Documents' },
    ],
  },
  '/monitor': {
    title: 'Monitor',
    description: 'Live classification activity, throughput, and router health',
    breadcrumbs: [
      { label: 'Home', href: '/workspaces' },
      { label: 'Monitor' },
    ],
  },
  '/admin': {
    title: 'Workspace Processing Configuration',
    description: 'Configure processing options on a workspace-by-workspace basis for document uploads',
    breadcrumbs: [
      { label: 'Home', href: '/workspaces' },
      { label: 'Admin Config' },
    ],
  },
};

export function getRouteMeta(pathname: string) {
  return routeMeta[pathname] ?? {
    title: 'Doc Uploader',
    breadcrumbs: [{ label: 'Home', href: '/workspaces' }],
  };
}

export function getSelectedWorkspaceName(): string | undefined {
  try {
    const raw = sessionStorage.getItem('selectedWorkspace');
    if (!raw) return undefined;
    const workspace = JSON.parse(raw) as { name?: string };
    return workspace.name;
  } catch {
    return undefined;
  }
}

export function getBreadcrumbsForPath(pathname: string): BreadcrumbConfig[] {
  const meta = getRouteMeta(pathname);
  const workspaceName = getSelectedWorkspaceName();

  if (!workspaceName || pathname === '/workspaces' || pathname === '/admin') {
    return meta.breadcrumbs;
  }

  if (pathname === '/document-transfer' || pathname === '/documents') {
    return [
      { label: 'Home', href: '/workspaces' },
      { label: 'Workspaces', href: '/workspaces' },
      { label: workspaceName, href: '/document-transfer' },
      { label: meta.breadcrumbs[meta.breadcrumbs.length - 1].label },
    ];
  }

  return meta.breadcrumbs;
}
