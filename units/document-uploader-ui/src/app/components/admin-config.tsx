import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  BadgeWithDot,
  Button,
  Checkbox,
  Input,
  NativeSelect,
  RadioButton,
  RadioGroup,
  Select,
  SectionHeader,
  TabList,
  Tabs,
  Toggle,
} from '@opus2-platform/codex';
import type { SelectItemType } from '@opus2-platform/codex';
import { ArrowDown, CheckCircle, Database01, Folder, Save01, Translate01 } from '@opus2-platform/icons';
import { getBreadcrumbsForPath, getRouteMeta } from '../config/navigation';
import { appToast } from '../lib/app-toast';
import {
  DEFAULT_WORKSPACE_ID,
  saveWorkspaceConfig,
  workspaceConfig as fetchWorkspaceConfig,
} from '../lib/graphql';
import { dashboardContentWidthClassName, PageFrame } from './layout/page-frame';

type TabId = 'destination' | 'processing' | 'email' | 'ocr';

const adminTabs: { id: TabId; label: string }[] = [
  { id: 'destination', label: 'Destination' },
  { id: 'processing', label: 'Processing' },
  { id: 'email', label: 'Email' },
  { id: 'ocr', label: 'OCR' },
];

interface WorkspaceConfig {
  destinationWorkspace: string;
  destinationFolder: string;
  processingOptions: {
    zipExtraction: boolean;
    conversionRules: {
      doc: boolean;
      docx: boolean;
      xls: boolean;
      xlsx: boolean;
      ppt: boolean;
      pptx: boolean;
      txt: boolean;
      rtf: boolean;
      jpg: boolean;
      png: boolean;
      tiff: boolean;
    };
    emailConversionRules: {
      convertToPdf: boolean;
      extractAttachments: boolean;
      includeHeaders: boolean;
      extractMetadata: boolean;
      attachmentHandling: 'separate' | 'inline' | 'both';
      preserveThreading: boolean;
    };
    ocr: 'if-required' | 'always' | 'never';
    ocrLanguage: string;
  };
}

interface DestinationWorkspace {
  id: string;
  name: string;
  caseNumber: string;
  folders: DestinationFolder[];
}

interface DestinationFolder {
  id: string;
  name: string;
  path: string;
  subfolders?: DestinationFolder[];
}

const mockDestinationWorkspaces: DestinationWorkspace[] = [
  {
    id: 'dws-001',
    name: 'Smith v. Johnson Construction (Claimant)',
    caseNumber: 'CIV-2024-001234',
    folders: [
      {
        id: 'f-001',
        name: 'Incoming Documents (Opus 2 ONLY)',
        path: '/Incoming Documents (Opus 2 ONLY)',
        subfolders: [
          { id: 'f-001a', name: 'Client Uploads', path: '/Incoming Documents (Opus 2 ONLY)/Client Uploads' },
          { id: 'f-001b', name: 'Third Party', path: '/Incoming Documents (Opus 2 ONLY)/Third Party' },
        ],
      },
      {
        id: 'f-002',
        name: 'Staging',
        path: '/Staging',
        subfolders: [
          { id: 'f-002a', name: 'To Review', path: '/Staging/To Review' },
          { id: 'f-002b', name: 'Processed', path: '/Staging/Processed' },
        ],
      },
      { id: 'f-003', name: 'Production', path: '/Production' },
    ],
  },
  {
    id: 'dws-002',
    name: 'ABC Corp Financial Audit 2024 (Claimant)',
    caseNumber: 'AUD-2024-005678',
    folders: [
      { id: 'f-010', name: 'Uploads', path: '/Uploads' },
      { id: 'f-011', name: 'Processing Queue', path: '/Processing Queue' },
      {
        id: 'f-012',
        name: 'Completed',
        path: '/Completed',
        subfolders: [
          { id: 'f-012a', name: 'Q1 2024', path: '/Completed/Q1 2024' },
          { id: 'f-012b', name: 'Q2 2024', path: '/Completed/Q2 2024' },
        ],
      },
    ],
  },
  {
    id: 'dws-003',
    name: 'Patent Litigation - Tech Innovations (Claimant)',
    caseNumber: 'PAT-2024-009012',
    folders: [
      {
        id: 'f-020',
        name: 'Discovery',
        path: '/Discovery',
        subfolders: [
          { id: 'f-020a', name: 'Incoming', path: '/Discovery/Incoming' },
          { id: 'f-020b', name: 'Outgoing', path: '/Discovery/Outgoing' },
        ],
      },
      { id: 'f-021', name: 'Expert Reports', path: '/Expert Reports' },
      { id: 'f-022', name: 'Pleadings', path: '/Pleadings' },
    ],
  },
  {
    id: 'dws-004',
    name: 'Global Merger Review (Claimant)',
    caseNumber: 'MRG-2024-003456',
    folders: [
      { id: 'f-030', name: 'Due Diligence', path: '/Due Diligence' },
      { id: 'f-031', name: 'Contracts', path: '/Contracts' },
      { id: 'f-032', name: 'Regulatory Filings', path: '/Regulatory Filings' },
    ],
  },
];

const defaultConfig: WorkspaceConfig = {
  destinationWorkspace: 'dws-001',
  destinationFolder: 'f-001a',
  processingOptions: {
    zipExtraction: true,
    conversionRules: {
      doc: true, docx: true, xls: true, xlsx: true, ppt: true, pptx: true,
      txt: true, rtf: true, jpg: false, png: false, tiff: false,
    },
    emailConversionRules: {
      convertToPdf: true, extractAttachments: true, includeHeaders: true,
      extractMetadata: true, attachmentHandling: 'both', preserveThreading: true,
    },
    ocr: 'if-required',
    ocrLanguage: 'en',
  },
};

const languageOptions: SelectItemType[] = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'it', label: 'Italian' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'nl', label: 'Dutch' },
  { id: 'pl', label: 'Polish' },
  { id: 'ru', label: 'Russian' },
  { id: 'zh', label: 'Chinese (Simplified)' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
];

const attachmentHandlingItems: SelectItemType[] = [
  { id: 'separate', label: 'Separate documents' },
  { id: 'inline', label: 'Inline with email' },
  { id: 'both', label: 'Both separate and inline' },
];

const fileTypeGroups: {
  label: string;
  types: (keyof WorkspaceConfig['processingOptions']['conversionRules'])[];
}[] = [
  { label: 'Office', types: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] },
  { label: 'Text', types: ['txt', 'rtf'] },
  { label: 'Images', types: ['jpg', 'png', 'tiff'] },
];

const fileTypeLabels: Record<string, string> = {
  doc: '.doc', docx: '.docx', xls: '.xls', xlsx: '.xlsx',
  ppt: '.ppt', pptx: '.pptx', txt: '.txt', rtf: '.rtf',
  jpg: '.jpg', png: '.png', tiff: '.tiff',
};

const workspaceSelectItems: SelectItemType[] = mockDestinationWorkspaces.map((ws) => ({
  id: ws.id,
  label: ws.name,
  supportingText: ws.caseNumber,
}));

const getAllFolders = (folders: DestinationFolder[]): DestinationFolder[] => {
  const result: DestinationFolder[] = [];
  for (const folder of folders) {
    result.push(folder);
    if (folder.subfolders) result.push(...getAllFolders(folder.subfolders));
  }
  return result;
};

function RowDivider() {
  return <hr className="h-px w-full border-none bg-border-secondary" aria-hidden="true" />;
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(200px,280px)_minmax(0,512px)] lg:gap-16">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-primary">{title}</p>
        {description && <p className="text-sm text-tertiary">{description}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function AdminConfig() {
  const [selectedTab, setSelectedTab] = useState<TabId>('destination');
  const [config, setConfig] = useState<WorkspaceConfig>(defaultConfig);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Classification policy — the fields actually backed by the router's
  // workspaceConfig. (The destination/conversion/email/OCR tabs above describe
  // pipeline behaviour that has no backing on the router yet, so they stay
  // local UI for now.)
  const [policy, setPolicy] = useState({
    policyVersion: 'v1',
    threshold: 0.7,
    maxZipDepth: 5,
    quarantineMacros: true,
    hashTtlDays: 30 as number | null,
  });

  useEffect(() => {
    fetchWorkspaceConfig(DEFAULT_WORKSPACE_ID)
      .then((cfg) => {
        if (cfg) {
          setPolicy({
            policyVersion: cfg.policyVersion,
            threshold: cfg.threshold,
            maxZipDepth: cfg.maxZipDepth,
            quarantineMacros: cfg.quarantineMacros,
            hashTtlDays: cfg.hashTtlDays ?? null,
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await saveWorkspaceConfig({
        workspaceId: DEFAULT_WORKSPACE_ID,
        policyVersion: policy.policyVersion,
        threshold: policy.threshold,
        maxZipDepth: policy.maxZipDepth,
        quarantineMacros: policy.quarantineMacros,
        hashTtlDays: policy.hashTtlDays,
      });
      setSaveStatus('saved');
      appToast.success('Configuration saved', 'Classification policy persisted to the workspace.');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      setSaveStatus('idle');
      appToast.error('Save failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const updateConversionRule = (
    fileType: keyof WorkspaceConfig['processingOptions']['conversionRules'],
    value: boolean,
  ) =>
    setConfig((prev) => ({
      ...prev,
      processingOptions: {
        ...prev.processingOptions,
        conversionRules: { ...prev.processingOptions.conversionRules, [fileType]: value },
      },
    }));

  const updateEmailRule = (
    rule: keyof WorkspaceConfig['processingOptions']['emailConversionRules'],
    value: boolean | string,
  ) =>
    setConfig((prev) => ({
      ...prev,
      processingOptions: {
        ...prev.processingOptions,
        emailConversionRules: { ...prev.processingOptions.emailConversionRules, [rule]: value },
      },
    }));

  const updateDestinationWorkspace = (workspaceId: string) => {
    const selectedWs = mockDestinationWorkspaces.find((ws) => ws.id === workspaceId);
    setConfig((prev) => ({
      ...prev,
      destinationWorkspace: workspaceId,
      destinationFolder: selectedWs?.folders[0]?.id ?? '',
    }));
  };

  const getSelectedWorkspace = () =>
    mockDestinationWorkspaces.find((ws) => ws.id === config.destinationWorkspace);

  const folderSelectItems = useMemo<SelectItemType[]>(() => {
    const ws = getSelectedWorkspace();
    if (!ws) return [];
    return getAllFolders(ws.folders).map((folder) => {
      const depth = (folder.path.match(/\//g) || []).length - 1;
      return {
        id: folder.id,
        label: `${' '.repeat(depth * 2)}${folder.name}`,
        supportingText: folder.path,
      };
    });
  }, [config.destinationWorkspace]);

  const getSelectedFolderPath = () => {
    const ws = getSelectedWorkspace();
    if (!ws) return '';
    return getAllFolders(ws.folders).find((f) => f.id === config.destinationFolder)?.path ?? '';
  };

  const routeMeta = getRouteMeta('/admin');
  const email = config.processingOptions.emailConversionRules;

  const tabNav = (
    <>
      <NativeSelect
        size="sm"
        aria-label="Settings section"
        className="md:hidden w-full"
        value={selectedTab}
        onChange={(e) => setSelectedTab(e.target.value as TabId)}
        options={adminTabs.map((t) => ({ label: t.label, value: t.id }))}
      />
      <Tabs
        className="hidden w-full md:flex"
        selectedKey={selectedTab}
        onSelectionChange={(key) => setSelectedTab(key as TabId)}
      >
        <TabList type="underline" className="w-full" items={adminTabs} />
      </Tabs>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <PageFrame
          title={routeMeta.title}
          description={routeMeta.description}
          breadcrumbs={getBreadcrumbsForPath('/admin')}
          tabs={tabNav}
          flush
          titleBadge={
            <BadgeWithDot size="sm" color="brand" type="modern">
              Opus 2 Admin Only
            </BadgeWithDot>
          }
        >
          <div className="lg:px-10">
          <div className={`flex flex-col gap-8 pb-8 ${dashboardContentWidthClassName}`}>

        {/* Destination tab */}
        {selectedTab === 'destination' && (
          <div className="flex flex-col gap-8">
            <SectionHeader.Root>
              <SectionHeader.Group>
                <div className="flex flex-1 flex-col justify-center gap-0.5 self-stretch">
                  <SectionHeader.Heading>Destination</SectionHeader.Heading>
                  <SectionHeader.Subheading>
                    Pre-configure where uploaded documents will be delivered.
                  </SectionHeader.Subheading>
                </div>
              </SectionHeader.Group>
            </SectionHeader.Root>

            <div className="flex flex-col gap-5">
              <SettingRow
                title="Workspace"
                description="The target Opus 2 workspace for uploaded documents."
              >
                <div className="flex flex-col gap-3">
                  <Select
                    size="sm"
                    label="Workspace"
                    items={workspaceSelectItems}
                    value={config.destinationWorkspace}
                    onChange={(key) => key && updateDestinationWorkspace(String(key))}
                    icon={Database01}
                  >
                    {(item) => (
                      <Select.Item id={item.id} label={item.label} supportingText={item.supportingText} />
                    )}
                  </Select>
                  <div className="flex items-center gap-1 pl-2" aria-hidden="true">
                    <div className="h-3.5 w-px rounded-full bg-border-secondary" />
                    <ArrowDown className="size-3 text-quaternary" />
                  </div>
                  <Select
                    size="sm"
                    label="Folder"
                    items={folderSelectItems}
                    value={config.destinationFolder}
                    onChange={(key) =>
                      key && setConfig((prev) => ({ ...prev, destinationFolder: String(key) }))
                    }
                    icon={Folder}
                    isDisabled={!config.destinationWorkspace}
                  >
                    {(item) => (
                      <Select.Item id={item.id} label={item.label} supportingText={item.supportingText} />
                    )}
                  </Select>
                  {config.destinationWorkspace && config.destinationFolder && (
                    <Alert
                      color="brand"
                      title="Delivery path"
                      description={
                        <>
                          Documents will be delivered to{' '}
                          <strong>{getSelectedWorkspace()?.name}</strong> →{' '}
                          <strong>{getSelectedFolderPath()}</strong>
                        </>
                      }
                    />
                  )}
                </div>
              </SettingRow>
            </div>
          </div>
        )}

        {/* Processing tab */}
        {selectedTab === 'processing' && (
          <div className="flex flex-col gap-8">
            <SectionHeader.Root>
              <SectionHeader.Group>
                <div className="flex flex-1 flex-col justify-center gap-0.5 self-stretch">
                  <SectionHeader.Heading>File Processing</SectionHeader.Heading>
                  <SectionHeader.Subheading>
                    Configure how uploaded files are extracted and converted to PDF.
                  </SectionHeader.Subheading>
                </div>
              </SectionHeader.Group>
            </SectionHeader.Root>

            <div className="flex flex-col gap-5">
              <SettingRow
                title="ZIP extraction"
                description="Automatically unpack ZIP archives when files are uploaded."
              >
                <Toggle
                  slim
                  size="sm"
                  label="Enabled"
                  isSelected={config.processingOptions.zipExtraction}
                  onChange={(value) =>
                    setConfig((prev) => ({
                      ...prev,
                      processingOptions: { ...prev.processingOptions, zipExtraction: value },
                    }))
                  }
                />
              </SettingRow>

              <RowDivider />

              <SettingRow
                title="Convert to PDF"
                description="Select which file types are automatically converted during processing."
              >
                <div className="flex flex-col gap-4">
                  {fileTypeGroups.map((group) => (
                    <div key={group.label}>
                      <p className="mb-2 text-xs font-medium text-tertiary">{group.label}</p>
                      <div className="flex flex-wrap gap-x-6 gap-y-2">
                        {group.types.map((fileType) => (
                          <Checkbox
                            key={fileType}
                            size="sm"
                            label={fileTypeLabels[fileType]}
                            isSelected={config.processingOptions.conversionRules[fileType]}
                            onChange={(selected) => updateConversionRule(fileType, selected)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </SettingRow>

              <RowDivider />

              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-primary">
                  Classification policy
                </p>
                <p className="text-sm text-tertiary">
                  Persisted to the workspace via the router (workspaceConfig).
                </p>
              </div>

              <SettingRow
                title="Confidence threshold"
                description="Minimum score (0–1) before a classification is trusted."
              >
                <Input
                  size="sm"
                  type="number"
                  aria-label="Confidence threshold"
                  value={String(policy.threshold)}
                  onChange={(v) =>
                    setPolicy((p) => ({ ...p, threshold: Number(v) || 0 }))
                  }
                  className="max-w-32"
                />
              </SettingRow>

              <RowDivider />

              <SettingRow
                title="Max ZIP depth"
                description="How many levels of nested archives to extract."
              >
                <Input
                  size="sm"
                  type="number"
                  aria-label="Max ZIP depth"
                  value={String(policy.maxZipDepth)}
                  onChange={(v) =>
                    setPolicy((p) => ({ ...p, maxZipDepth: Math.max(0, Math.trunc(Number(v) || 0)) }))
                  }
                  className="max-w-32"
                />
              </SettingRow>

              <RowDivider />

              <SettingRow
                title="Quarantine macros"
                description="Hold documents containing macros for review."
              >
                <Toggle
                  slim
                  size="sm"
                  label="Enabled"
                  isSelected={policy.quarantineMacros}
                  onChange={(v) => setPolicy((p) => ({ ...p, quarantineMacros: v }))}
                />
              </SettingRow>

              <RowDivider />

              <SettingRow
                title="Content-hash TTL (days)"
                description="How long dedup hashes are retained."
              >
                <Input
                  size="sm"
                  type="number"
                  aria-label="Content-hash TTL in days"
                  value={policy.hashTtlDays == null ? '' : String(policy.hashTtlDays)}
                  onChange={(v) =>
                    setPolicy((p) => ({ ...p, hashTtlDays: v === '' ? null : Math.trunc(Number(v) || 0) }))
                  }
                  className="max-w-32"
                />
              </SettingRow>
            </div>
          </div>
        )}

        {/* Email tab */}
        {selectedTab === 'email' && (
          <div className="flex flex-col gap-8">
            <SectionHeader.Root>
              <SectionHeader.Group>
                <div className="flex flex-1 flex-col justify-center gap-0.5 self-stretch">
                  <SectionHeader.Heading>Email</SectionHeader.Heading>
                  <SectionHeader.Subheading>
                    How .eml and .msg files are handled during processing.
                  </SectionHeader.Subheading>
                </div>
              </SectionHeader.Group>
            </SectionHeader.Root>

            <div className="flex flex-col gap-5">
              <SettingRow title="Convert to PDF" description="Render email messages as PDF documents.">
                <Toggle slim size="sm" label="Enabled" isSelected={email.convertToPdf} onChange={(v) => updateEmailRule('convertToPdf', v)} />
              </SettingRow>
              <RowDivider />
              <SettingRow title="Extract attachments" description="Save attachments as separate documents.">
                <Toggle slim size="sm" label="Enabled" isSelected={email.extractAttachments} onChange={(v) => updateEmailRule('extractAttachments', v)} />
              </SettingRow>
              <RowDivider />
              <SettingRow title="Include headers" description="Embed email headers in the converted PDF.">
                <Toggle slim size="sm" label="Enabled" isSelected={email.includeHeaders} onChange={(v) => updateEmailRule('includeHeaders', v)} />
              </SettingRow>
              <RowDivider />
              <SettingRow title="Extract metadata" description="Capture To, From, CC, and other fields as structured data.">
                <Toggle slim size="sm" label="Enabled" isSelected={email.extractMetadata} onChange={(v) => updateEmailRule('extractMetadata', v)} />
              </SettingRow>
              <RowDivider />
              <SettingRow title="Preserve threading" description="Keep reply chains grouped together.">
                <Toggle slim size="sm" label="Enabled" isSelected={email.preserveThreading} onChange={(v) => updateEmailRule('preserveThreading', v)} />
              </SettingRow>

              {email.convertToPdf && (
                <>
                  <RowDivider />
                  <SettingRow
                    title="Attachment handling"
                    description="How attachments are stored relative to the email document."
                  >
                    <Select
                      size="sm"
                      label="Handling"
                      items={attachmentHandlingItems}
                      value={email.attachmentHandling}
                      onChange={(key) =>
                        key &&
                        updateEmailRule('attachmentHandling', String(key) as 'separate' | 'inline' | 'both')
                      }
                    >
                      {(item) => <Select.Item id={item.id} label={item.label} />}
                    </Select>
                  </SettingRow>
                </>
              )}
            </div>
          </div>
        )}

        {/* OCR tab */}
        {selectedTab === 'ocr' && (
          <div className="flex flex-col gap-8">
            <SectionHeader.Root>
              <SectionHeader.Group>
                <div className="flex flex-1 flex-col justify-center gap-0.5 self-stretch">
                  <SectionHeader.Heading>OCR</SectionHeader.Heading>
                  <SectionHeader.Subheading>
                    Optical character recognition settings for scanned documents.
                  </SectionHeader.Subheading>
                </div>
              </SectionHeader.Group>
            </SectionHeader.Root>

            <div className="flex flex-col gap-5">
              <SettingRow title="Processing mode" description="When OCR should be applied to documents.">
                <RadioGroup
                  size="sm"
                  value={config.processingOptions.ocr}
                  onChange={(value) =>
                    setConfig((prev) => ({
                      ...prev,
                      processingOptions: {
                        ...prev.processingOptions,
                        ocr: value as 'if-required' | 'always' | 'never',
                      },
                    }))
                  }
                  className="gap-3"
                >
                  <RadioButton value="if-required" label="If required" hint="Only when a document has no text layer" />
                  <RadioButton value="always" label="Always" hint="Applied to every document regardless" />
                  <RadioButton value="never" label="Never" hint="OCR is skipped entirely" />
                </RadioGroup>
              </SettingRow>

              {config.processingOptions.ocr !== 'never' && (
                <>
                  <RowDivider />
                  <SettingRow title="Language" description="Primary language to use when performing OCR.">
                    <Select
                      size="sm"
                      label="Language"
                      items={languageOptions}
                      value={config.processingOptions.ocrLanguage}
                      onChange={(key) =>
                        key &&
                        setConfig((prev) => ({
                          ...prev,
                          processingOptions: {
                            ...prev.processingOptions,
                            ocrLanguage: String(key),
                          },
                        }))
                      }
                      icon={Translate01}
                    >
                      {(item) => <Select.Item id={item.id} label={item.label} />}
                    </Select>
                  </SettingRow>
                </>
              )}
            </div>
          </div>
        )}

          </div>
          </div>
        </PageFrame>
      </div>

      <div className="shrink-0 border-t border-secondary bg-primary px-6 py-4 lg:px-10">
        <div className={`flex items-center justify-end gap-3 ${dashboardContentWidthClassName}`}>
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1.5 text-sm text-success-primary">
              <CheckCircle className="size-4" aria-hidden="true" />
              Saved
            </span>
          )}
          <Button
            size="sm"
            color="primary"
            iconLeading={Save01}
            onClick={handleSave}
            isDisabled={saveStatus === 'saving'}
            isLoading={saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
