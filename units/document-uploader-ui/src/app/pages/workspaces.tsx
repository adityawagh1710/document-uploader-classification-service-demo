import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Badge,
  BadgeWithIcon,
  ButtonGroup,
  ButtonGroupItem,
  EmptyState,
  Input,
  Select,
  Table,
} from '@opus2-platform/codex';
import type { SelectItemType } from '@opus2-platform/codex';
import {
  CheckCircle,
  Folder,
  LayoutGrid02,
  List,
  Lock01,
  SearchLg,
  Users01,
  XCircle,
} from '@opus2-platform/icons';
import { AppTableCard } from '../components/layout/app-table-card';
import { PageFrame } from '../components/layout/page-frame';
import { getBreadcrumbsForPath, getRouteMeta } from '../config/navigation';
import { mockWorkspaces, type Workspace } from '../data/mock-workspaces';
import { appToast } from '../lib/app-toast';

type WorkspaceView = 'table' | 'grid';

const filterItems: SelectItemType[] = [
  { id: 'all', label: 'All workspaces' },
  { id: 'private', label: 'Private only' },
  { id: 'shared', label: 'Shared only' },
];

const routeMeta = getRouteMeta('/workspaces');

function formatLastAccessed(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatCount(value: number) {
  return value.toLocaleString('en-GB');
}

function WorkspaceTypeBadge({ type }: { type: Workspace['type'] }) {
  const TypeIcon = type === 'private' ? Lock01 : Users01;

  return (
    <BadgeWithIcon
      size="sm"
      color={type === 'private' ? 'gray' : 'brand'}
      type="pill-color"
      iconLeading={TypeIcon}
    >
      {type === 'private' ? 'Private' : 'Shared'}
    </BadgeWithIcon>
  );
}

function WorkspaceTransferBadge({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <BadgeWithIcon size="sm" color="success" type="pill-color" iconLeading={CheckCircle}>
        Transfer enabled
      </BadgeWithIcon>
    );
  }

  return (
    <BadgeWithIcon size="sm" color="gray" type="pill-color" iconLeading={XCircle}>
      Not enabled
    </BadgeWithIcon>
  );
}

function WorkspaceGridCard({
  workspace,
  onSelect,
}: {
  workspace: Workspace;
  onSelect: (workspace: Workspace) => void;
}) {
  const isEnabled = workspace.documentTransferEnabled;

  return (
    <button
      type="button"
      onClick={() => onSelect(workspace)}
      disabled={!isEnabled}
      className={`flex flex-col rounded-xl border border-secondary bg-primary p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-solid ${isEnabled ? 'cursor-pointer hover:border-brand-solid hover:bg-secondary' : 'cursor-not-allowed opacity-60'
        }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <WorkspaceTypeBadge type={workspace.type} />
        <WorkspaceTransferBadge enabled={isEnabled} />
      </div>

      <h3 className="mb-1 line-clamp-2 text-sm font-semibold text-primary">{workspace.name}</h3>
      <p className="mb-4 font-mono text-xs text-tertiary">{workspace.caseNumber}</p>

      <dl className="grid grid-cols-2 gap-3 border-t border-secondary pt-3 text-xs text-tertiary">
        <div>
          <dt className="sr-only">Documents</dt>
          <dd>{formatCount(workspace.documentCount)} documents</dd>
        </div>
        <div>
          <dt className="sr-only">Members</dt>
          <dd>{workspace.members} members</dd>
        </div>
        <div className="col-span-2">
          <dt className="sr-only">Last accessed</dt>
          <dd>Last accessed {formatLastAccessed(workspace.lastAccessed)}</dd>
        </div>
      </dl>
    </button>
  );
}

export function Workspaces() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'private' | 'shared'>('all');
  const [viewMode, setViewMode] = useState<WorkspaceView>('grid');

  const filteredWorkspaces = useMemo(
    () =>
      mockWorkspaces.filter((workspace) => {
        const matchesSearch =
          workspace.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          workspace.caseNumber.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFilter = filterType === 'all' || workspace.type === filterType;
        return matchesSearch && matchesFilter;
      }),
    [searchQuery, filterType],
  );

  const disabledWorkspaceIds = useMemo(
    () =>
      new Set(
        filteredWorkspaces
          .filter((workspace) => !workspace.documentTransferEnabled)
          .map((workspace) => workspace.id),
      ),
    [filteredWorkspaces],
  );

  const resultLabel = useMemo(() => {
    const total = mockWorkspaces.length;
    const showing = filteredWorkspaces.length;
    const noun = showing === 1 ? 'workspace' : 'workspaces';

    if (showing === total) {
      return `${total} ${noun}`;
    }

    return `${showing} of ${total} ${noun}`;
  }, [filteredWorkspaces.length]);

  const handleWorkspaceSelect = (workspace: Workspace) => {
    if (workspace.documentTransferEnabled) {
      sessionStorage.setItem('selectedWorkspace', JSON.stringify(workspace));
      appToast.success('Workspace opened', workspace.name);
      navigate('/document-transfer');
    }
  };

  return (
    <PageFrame
      title={routeMeta.title}
      titleBadge={<Badge size="sm" color="gray" type="modern">{resultLabel}</Badge>}
      description={routeMeta.description}
      breadcrumbs={getBreadcrumbsForPath('/workspaces')}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-center">
          <Input
            size="sm"
            className="md:col-span-7"
            placeholder="Search by name or case number..."
            value={searchQuery}
            onChange={setSearchQuery}
            icon={SearchLg}
          />

          <Select
            size="sm"
            className="md:col-span-3"
            items={filterItems}
            selectedKey={filterType}
            onSelectionChange={(key) => {
              if (key) setFilterType(key as 'all' | 'private' | 'shared');
            }}
            aria-label="Filter workspaces"
          >
            {(item) => <Select.Item id={item.id} label={item.label} />}
          </Select>

          <div className="flex justify-start md:col-span-2 md:justify-end">
            <ButtonGroup
              size="sm"
              selectedKeys={new Set([viewMode])}
              onSelectionChange={(keys) => {
                const nextView = [...keys][0];
                if (nextView === 'table' || nextView === 'grid') {
                  setViewMode(nextView);
                }
              }}
              aria-label="Workspace view"
            >
              <ButtonGroupItem id="table" iconLeading={List} aria-label="Table view" />
              <ButtonGroupItem id="grid" iconLeading={LayoutGrid02} aria-label="Grid view" />
            </ButtonGroup>
          </div>
        </div>

        {filteredWorkspaces.length > 0 ? (
          viewMode === 'table' ? (
            <AppTableCard size="sm">
              <Table
                aria-label="Workspaces"
                size="sm"
                disabledKeys={disabledWorkspaceIds}
                onRowAction={(key) => {
                  const workspace = filteredWorkspaces.find((item) => item.id === String(key));
                  if (workspace) handleWorkspaceSelect(workspace);
                }}
              >
                <Table.Header>
                  <Table.Head key="workspace" id="workspace" label="Workspace" isRowHeader className="min-w-52" />
                  <Table.Head key="type" id="type" label="Type" className="min-w-28" />
                  <Table.Head key="documents" id="documents" label="Documents" className="min-w-28" />
                  <Table.Head key="members" id="members" label="Members" className="min-w-24" />
                  <Table.Head key="lastAccessed" id="lastAccessed" label="Last accessed" className="min-w-32" />
                  <Table.Head key="status" id="status" label="Status" className="min-w-36" />
                </Table.Header>

                <Table.Body>
                  {filteredWorkspaces.map((workspace) => (
                    <Table.Row
                      key={workspace.id}
                      id={workspace.id}
                      className={workspace.documentTransferEnabled ? 'cursor-pointer' : undefined}
                    >
                      <Table.Cell className="min-w-52">
                        <p className="truncate text-sm font-medium text-primary">{workspace.name}</p>
                        <p className="truncate font-mono text-xs text-tertiary">{workspace.caseNumber}</p>
                      </Table.Cell>
                      <Table.Cell>
                        <WorkspaceTypeBadge type={workspace.type} />
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm text-secondary">
                        {formatCount(workspace.documentCount)}
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm text-secondary">
                        {workspace.members}
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm text-tertiary">
                        {formatLastAccessed(workspace.lastAccessed)}
                      </Table.Cell>
                      <Table.Cell>
                        <WorkspaceTransferBadge enabled={workspace.documentTransferEnabled} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </AppTableCard>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredWorkspaces.map((workspace) => (
                <WorkspaceGridCard
                  key={workspace.id}
                  workspace={workspace}
                  onSelect={handleWorkspaceSelect}
                />
              ))}
            </div>
          )
        ) : (
          <EmptyState size="sm">
            <EmptyState.Header pattern="circle">
              <EmptyState.FeaturedIcon icon={Folder} color="gray" size="sm" />
            </EmptyState.Header>
            <EmptyState.Content>
              <EmptyState.Title>No workspaces found</EmptyState.Title>
              <EmptyState.Description>
                Try adjusting your search or filter criteria.
              </EmptyState.Description>
            </EmptyState.Content>
          </EmptyState>
        )}
      </div>
    </PageFrame>
  );
}
