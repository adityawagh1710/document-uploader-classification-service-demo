import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { CommandMenu } from '@opus2-platform/codex';
import type { CommandMenuGroupType } from '@opus2-platform/codex';
import {
  Activity,
  File06,
  HomeLine,
  Lock01,
  LogOut01,
  Settings01,
  UploadCloud02,
  Users01,
} from '@opus2-platform/icons';
import type { Selection } from 'react-aria-components';
import { mockWorkspaces, type Workspace } from '../../data/mock-workspaces';
import { appToast } from '../../lib/app-toast';

interface CommandMenuContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

function getSelectedWorkspace(): Workspace | undefined {
  try {
    const raw = sessionStorage.getItem('selectedWorkspace');
    if (!raw) return undefined;
    return JSON.parse(raw) as Workspace;
  } catch {
    return undefined;
  }
}

function buildCommandMenuGroups(selectedWorkspace?: Workspace): CommandMenuGroupType[] {
  const groups: CommandMenuGroupType[] = [
    {
      id: 'navigation',
      title: 'Navigation',
      items: [
        {
          id: 'nav-workspaces',
          type: 'icon',
          icon: HomeLine,
          label: 'Workspaces',
          description: 'Browse case workspaces',
        },
        {
          id: 'nav-document-transfer',
          type: 'icon',
          icon: UploadCloud02,
          label: 'Document Transfer',
          description: 'Upload and transfer documents',
        },
        {
          id: 'nav-documents',
          type: 'icon',
          icon: File06,
          label: 'Published Documents',
          description: 'Search published documents',
        },
        {
          id: 'nav-monitor',
          type: 'icon',
          icon: Activity,
          label: 'Monitor',
          description: 'Live classification activity and router health',
        },
        {
          id: 'nav-admin',
          type: 'icon',
          icon: Settings01,
          label: 'Admin Config',
          description: 'Workspace processing settings',
        },
      ],
    },
  ];

  if (selectedWorkspace) {
    groups.push({
      id: 'current-workspace',
      title: 'Current workspace',
      items: [
        {
          id: 'current-document-transfer',
          type: 'icon',
          icon: UploadCloud02,
          label: 'Document Transfer',
          description: selectedWorkspace.name,
        },
        {
          id: 'current-documents',
          type: 'icon',
          icon: File06,
          label: 'Published Documents',
          description: selectedWorkspace.name,
        },
      ],
    });
  }

  const switchableWorkspaces = mockWorkspaces.filter((workspace) => workspace.documentTransferEnabled);

  if (switchableWorkspaces.length > 0) {
    groups.push({
      id: 'switch-workspace',
      title: 'Switch workspace',
      items: switchableWorkspaces.map((workspace) => ({
        id: `workspace-${workspace.id}`,
        type: 'icon' as const,
        icon: workspace.type === 'private' ? Lock01 : Users01,
        label: workspace.name,
        description: workspace.caseNumber,
      })),
    });
  }

  groups.push({
    id: 'account',
    title: 'Account',
    items: [
      {
        id: 'sign-out',
        type: 'icon',
        icon: LogOut01,
        label: 'Sign out',
        description: 'Return to login',
      },
    ],
  });

  return groups;
}

export function CommandMenuProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  const selectedWorkspace = useMemo(() => getSelectedWorkspace(), [isOpen]);
  const menuGroups = useMemo(() => buildCommandMenuGroups(selectedWorkspace), [selectedWorkspace]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen(true);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSelectionChange = (keys: Selection) => {
    if (keys === 'all') return;
    const selectedId = [...keys][0];
    if (!selectedId) return;

    setIsOpen(false);

    const id = String(selectedId);

    if (id === 'nav-workspaces') {
      navigate('/workspaces');
      return;
    }

    if (id === 'nav-document-transfer' || id === 'current-document-transfer') {
      navigate('/document-transfer');
      return;
    }

    if (id === 'nav-documents' || id === 'current-documents') {
      navigate('/documents');
      return;
    }

    if (id === 'nav-monitor') {
      navigate('/monitor');
      return;
    }

    if (id === 'nav-admin') {
      navigate('/admin');
      return;
    }

    if (id === 'sign-out') {
      navigate('/login');
      return;
    }

    if (id.startsWith('workspace-')) {
      const workspaceId = id.replace('workspace-', '');
      const workspace = mockWorkspaces.find((item) => item.id === workspaceId);

      if (workspace?.documentTransferEnabled) {
        sessionStorage.setItem('selectedWorkspace', JSON.stringify(workspace));
        appToast.success('Workspace opened', workspace.name);
        navigate('/document-transfer');
      }
    }
  };

  return (
    <CommandMenuContext.Provider value={{ open, close, isOpen }}>
      {children}

      <CommandMenu
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        shortcut="⌘K"
        placeholder="Search pages, workspaces, and actions..."
        items={menuGroups}
        onSelectionChange={handleSelectionChange}
        emptyState={
          <p className="px-5 py-8 text-center text-sm text-tertiary">No matching results.</p>
        }
      >
        <CommandMenu.Group>
          <CommandMenu.List>
            {(group) => (
              <CommandMenu.Section key={group.id} id={group.id} title={group.title} items={group.items}>
                {(item) => <CommandMenu.Item key={item.id} {...item} />}
              </CommandMenu.Section>
            )}
          </CommandMenu.List>
          <CommandMenu.Footer />
        </CommandMenu.Group>
      </CommandMenu>
    </CommandMenuContext.Provider>
  );
}

export function useCommandMenu() {
  const context = useContext(CommandMenuContext);

  if (!context) {
    throw new Error('useCommandMenu must be used within CommandMenuProvider');
  }

  return context;
}
