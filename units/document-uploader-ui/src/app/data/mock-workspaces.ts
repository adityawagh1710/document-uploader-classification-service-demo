export interface Workspace {
  id: string;
  name: string;
  caseNumber: string;
  type: 'private' | 'shared';
  documentTransferEnabled: boolean;
  lastAccessed: string;
  documentCount: number;
  members: number;
}

export const mockWorkspaces: Workspace[] = [
  {
    id: 'ws-001',
    name: 'Smith v. Johnson Construction',
    caseNumber: 'CIV-2024-001234',
    type: 'private',
    documentTransferEnabled: true,
    lastAccessed: '2025-02-05',
    documentCount: 1243,
    members: 8,
  },
  {
    id: 'ws-002',
    name: 'ABC Corp Financial Audit 2024',
    caseNumber: 'AUD-2024-005678',
    type: 'shared',
    documentTransferEnabled: true,
    lastAccessed: '2025-02-04',
    documentCount: 856,
    members: 12,
  },
  {
    id: 'ws-003',
    name: 'Patent Litigation - Tech Innovations',
    caseNumber: 'PAT-2024-009012',
    type: 'private',
    documentTransferEnabled: true,
    lastAccessed: '2025-02-03',
    documentCount: 2107,
    members: 5,
  },
  {
    id: 'ws-004',
    name: 'Employment Tribunal - Wilson Case',
    caseNumber: 'EMP-2024-003456',
    type: 'private',
    documentTransferEnabled: false,
    lastAccessed: '2025-01-28',
    documentCount: 432,
    members: 4,
  },
  {
    id: 'ws-005',
    name: 'Merger & Acquisition - GlobalTech',
    caseNumber: 'M&A-2024-007890',
    type: 'shared',
    documentTransferEnabled: true,
    lastAccessed: '2025-01-25',
    documentCount: 3421,
    members: 18,
  },
];
