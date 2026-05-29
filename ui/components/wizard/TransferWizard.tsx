"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Upload,
  Activity,
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button, Card, CardBody, Badge, MockStub } from "@/components/ui/primitives";
import {
  ClassificationSummary,
  ConvertStatusCell,
  type ClassificationResult,
  type ConvertStatus,
} from "@/components/classification-bits";
import { getSelectedWorkspace } from "@/lib/ui-workspace";

/* ───────────────────────────── batch model ───────────────────────────── */

type DocStatus = "pending" | "uploading" | "classifying" | "done" | "error";

interface BatchDoc {
  localId: string;
  file: File;
  inputName: string;
  status: DocStatus;
  uploadPct: number;
  documentId?: string;
  result?: ClassificationResult;
  elapsedMs?: number;
  convertDispatch?: string;
  emailDispatch?: string;
  archiveDispatch?: string;
  error?: string;
}

interface ClassifyResponse {
  ok: boolean;
  result?: ClassificationResult;
  error?: unknown;
  elapsedMs?: number;
  documentId?: string;
  inputName?: string;
  archiveDispatch?: string;
  convertDispatch?: string;
  emailDispatch?: string;
}

// Live convert/email/archive fields the processing step pulls from /api/stats.
interface RecentItem {
  id: string;
  ts: string;
  workspaceId: string;
  convertStatus: ConvertStatus;
  convertStartedAt?: string | null;
  convertQueuedAt?: string | null;
  convertError?: string | null;
}

let localCounter = 0;
const nextLocalId = () => `local-${localCounter++}`;

function makeBatchId(): string {
  // Cosmetic operator-facing handle, mirroring the prototype's BATCH_… format.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `BATCH_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ───────────────────────────── wizard ───────────────────────────── */

const STEPS = [
  { id: 1, name: "Transfer Documents", icon: Upload },
  { id: 2, name: "Processing", icon: Activity },
] as const;

export function TransferWizard() {
  const [step, setStep] = useState(1);
  const [workspaceId, setWorkspaceId] = useState("wks-ui-001");
  const [hasSelection, setHasSelection] = useState(true);
  const [batchId] = useState(makeBatchId);
  const [docs, setDocs] = useState<BatchDoc[]>([]);

  useEffect(() => {
    const sel = getSelectedWorkspace();
    if (sel?.workspaceId) {
      setWorkspaceId(sel.workspaceId);
      setHasSelection(true);
    } else {
      setHasSelection(false);
    }
  }, []);

  const anyDone = docs.some((d) => d.status === "done");
  const busy = docs.some((d) => d.status === "uploading" || d.status === "classifying");

  const update = useCallback((localId: string, patch: Partial<BatchDoc>) => {
    setDocs((prev) => prev.map((d) => (d.localId === localId ? { ...d, ...patch } : d)));
  }, []);

  return (
    <div className="space-y-5">
      {/* workspace context */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Workspace</span>
          <Badge tone="primary">{workspaceId}</Badge>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">Batch</span>
          <Badge tone="neutral">{batchId}</Badge>
        </div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
          <ChevronLeft className="h-3 w-3" /> Back to Workspaces
        </Link>
      </div>

      {!hasSelection ? (
        <MockStub
          label="No workspace selected"
          detail={`defaulting to ${workspaceId} — pick one on the Workspaces page for the real target`}
        />
      ) : null}

      {/* stepper */}
      <div className="flex items-center justify-center gap-4">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = step > s.id;
          const current = step === s.id;
          return (
            <div key={s.id} className="flex items-center">
              <div className="flex w-36 flex-col items-center">
                <div
                  className={
                    "flex h-9 w-9 items-center justify-center rounded-full transition-colors " +
                    (done
                      ? "bg-primary text-primary-foreground"
                      : current
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-muted text-muted-foreground")
                  }
                >
                  {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
                </div>
                <span className={"mt-1.5 text-xs " + (current ? "font-bold text-foreground" : "text-muted-foreground")}>
                  {s.name}
                </span>
              </div>
              {i < STEPS.length - 1 ? (
                <div className={"mx-2 h-0.5 w-20 " + (done ? "bg-primary" : "bg-border")} />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* body */}
      {step === 1 ? (
        <UploadStep
          workspaceId={workspaceId}
          docs={docs}
          setDocs={setDocs}
          update={update}
          busy={busy}
        />
      ) : (
        <ProcessingStep docs={docs} workspaceId={workspaceId} />
      )}

      {/* nav */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" size="md" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <span className="text-xs text-muted-foreground">Step {step} of {STEPS.length}</span>
        {step < STEPS.length ? (
          <Button disabled={!anyDone || busy} onClick={() => setStep((s) => s + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Link href="/documents">
            <Button>View in Documents <ChevronRight className="h-4 w-4" /></Button>
          </Link>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── step 1: upload ───────────────────────────── */

function UploadStep({
  workspaceId,
  docs,
  setDocs,
  update,
  busy,
}: {
  workspaceId: string;
  docs: BatchDoc[];
  setDocs: React.Dispatch<React.SetStateAction<BatchDoc[]>>;
  update: (localId: string, patch: Partial<BatchDoc>) => void;
  busy: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files).map<BatchDoc>((file) => ({
      localId: nextLocalId(),
      file,
      inputName: file.name,
      status: "pending",
      uploadPct: 0,
    }));
    if (incoming.length) setDocs((prev) => [...prev, ...incoming]);
  };

  const removeDoc = (localId: string) => setDocs((prev) => prev.filter((d) => d.localId !== localId));

  const classifyOne = (doc: BatchDoc) =>
    new Promise<void>((resolve) => {
      update(doc.localId, { status: "uploading", uploadPct: 0, error: undefined });
      const form = new FormData();
      form.append("file", doc.file);
      form.append("workspaceId", workspaceId);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/classify");
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) update(doc.localId, { uploadPct: Math.round((evt.loaded / evt.total) * 100) });
      };
      xhr.upload.onloadend = () => update(doc.localId, { uploadPct: 100, status: "classifying" });
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText) as ClassifyResponse;
          if (data.ok && data.result) {
            update(doc.localId, {
              status: "done",
              documentId: data.documentId ?? data.result.documentId,
              result: data.result,
              elapsedMs: data.elapsedMs,
              convertDispatch: data.convertDispatch,
              emailDispatch: data.emailDispatch,
              archiveDispatch: data.archiveDispatch,
            });
          } else {
            update(doc.localId, {
              status: "error",
              error: typeof data.error === "string" ? data.error : JSON.stringify(data.error),
            });
          }
        } catch {
          update(doc.localId, { status: "error", error: `invalid response (status ${xhr.status})` });
        }
        resolve();
      };
      xhr.onerror = () => {
        update(doc.localId, { status: "error", error: "network error" });
        resolve();
      };
      xhr.send(form);
    });

  const classifyAll = async () => {
    // Sequential — keeps per-file upload progress legible and avoids hammering
    // the in-process classifier / S3 multipart uploads concurrently.
    for (const doc of docs) {
      if (doc.status === "pending" || doc.status === "error") {
        // eslint-disable-next-line no-await-in-loop
        await classifyOne(doc);
      }
    }
  };

  const pendingCount = docs.filter((d) => d.status === "pending" || d.status === "error").length;

  return (
    <Card>
      <CardBody className="space-y-4">
        {/* dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-button border-2 border-dashed px-6 py-10 text-center transition-colors " +
            (dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")
          }
        >
          <Upload className="h-8 w-8 text-primary" />
          <p className="text-sm font-bold text-foreground">Drag &amp; drop files, or click to browse</p>
          <p className="text-xs text-muted-foreground">
            Any file type — the classifier detects format from content (PDF, Office, email, archives, media…)
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* file list */}
        {docs.length > 0 ? (
          <div className="divide-y divide-border rounded-button border border-border">
            {docs.map((d) => (
              <div key={d.localId} className="flex items-center gap-3 px-3 py-2.5">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-foreground">{d.inputName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {(d.file.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  {d.status === "uploading" ? (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted">
                      <div className="h-full bg-primary transition-all" style={{ width: `${d.uploadPct}%` }} />
                    </div>
                  ) : null}
                  {d.status === "done" && d.result ? (
                    <div className="mt-1.5">
                      <ClassificationSummary c={d.result.classification} dedup={d.result.dedup} />
                    </div>
                  ) : null}
                  {d.status === "error" ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
                      <AlertCircle className="h-3 w-3" /> {d.error}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {d.status === "pending" ? <Badge tone="neutral">pending</Badge> : null}
                  {d.status === "uploading" ? <Badge tone="info">{d.uploadPct}%</Badge> : null}
                  {d.status === "classifying" ? <Badge tone="info">classifying…</Badge> : null}
                  {d.status === "done" ? (
                    <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> done</Badge>
                  ) : null}
                  {(d.status === "pending" || d.status === "error" || d.status === "done") ? (
                    <button
                      type="button"
                      onClick={() => removeDoc(d.localId)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* processing options — partly mock */}
        <div className="rounded-button border border-border bg-muted/40 p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Processing</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              <span className="font-bold text-foreground">Conversion</span> — files classified as{" "}
              <code className="rounded bg-background px-1">convert</code> are auto-dispatched to office-convert
              (live status on the next step). ✅ real
            </li>
            <li className="flex items-center gap-2">
              <span className="font-bold text-foreground">OCR</span>
              <MockStub label="Not backed" detail="no OCR service in this stack yet" />
            </li>
          </ul>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={classifyAll} disabled={busy || pendingCount === 0}>
            {busy ? "Classifying…" : `Classify ${pendingCount || ""} file${pendingCount === 1 ? "" : "s"}`}
          </Button>
          <span className="text-xs text-muted-foreground">
            {docs.filter((d) => d.status === "done").length}/{docs.length} classified
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

/* ───────────────────────────── step 2: processing ───────────────────────────── */

function ProcessingStep({ docs, workspaceId }: { docs: BatchDoc[]; workspaceId: string }) {
  const docIds = useMemo(
    () => new Set(docs.map((d) => d.documentId).filter(Boolean) as string[]),
    [docs],
  );
  const [live, setLive] = useState<Record<string, RecentItem>>({});

  const inflight = useMemo(
    () => Object.values(live).some((r) => r.convertStatus === "queued" || r.convertStatus === "converting"),
    [live],
  );
  const intervalMs = inflight ? 2000 : 4000;

  useEffect(() => {
    if (docIds.size === 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { recent: RecentItem[] };
        if (cancelled) return;
        const next: Record<string, RecentItem> = {};
        for (const r of body.recent ?? []) {
          if (docIds.has(r.id)) next[r.id] = r;
        }
        setLive(next);
      } catch {
        /* swallow — keep last snapshot */
      }
    };
    void tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [docIds, intervalMs]);

  const done = docs.filter((d) => d.status === "done");

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-secondary" />
          <h3 className="text-base font-bold">Processing dashboard</h3>
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="eq-bars"><span /><span /><span /></span> live
          </span>
        </div>

        {done.length === 0 ? (
          <p className="text-sm text-muted-foreground">No classified documents in this batch yet.</p>
        ) : (
          <div className="overflow-hidden rounded-button border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-bold">File</th>
                  <th className="px-3 py-2 font-bold">Classification</th>
                  <th className="px-3 py-2 font-bold">Conversion</th>
                  <th className="px-3 py-2 font-bold">Fan-out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {done.map((d) => {
                  const r = d.documentId ? live[d.documentId] : undefined;
                  const convertStatus: ConvertStatus =
                    r?.convertStatus ??
                    (d.convertDispatch === "ok"
                      ? "queued"
                      : d.convertDispatch === "dwg-excluded" || d.convertDispatch === "failed"
                        ? "failed"
                        : null);
                  return (
                    <tr key={d.localId}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-foreground">{d.inputName}</div>
                        {d.elapsedMs != null ? (
                          <div className="text-xs tabular-nums text-muted-foreground">{d.elapsedMs} ms</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {d.result ? (
                          <ClassificationSummary c={d.result.classification} dedup={d.result.dedup} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {d.documentId ? (
                          <ConvertStatusCell
                            item={{
                              id: d.documentId,
                              ts: r?.ts ?? "",
                              workspaceId,
                              convertStatus,
                              convertStartedAt: r?.convertStartedAt,
                              convertQueuedAt: r?.convertQueuedAt,
                              convertError: r?.convertError ?? (d.convertDispatch === "dwg-excluded" ? "dwg-excluded" : null),
                            }}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {d.archiveDispatch === "ok" ? <Badge tone="info">archive→zip</Badge> : null}
                          {d.emailDispatch === "ok" ? <Badge tone="info">email-extract</Badge> : null}
                          {d.convertDispatch === "dwg-excluded" ? <Badge tone="warn">dwg-excluded</Badge> : null}
                          {d.archiveDispatch !== "ok" && d.emailDispatch !== "ok" && d.convertDispatch !== "dwg-excluded" ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Conversion status updates live from the convert-worker (queued → converting → done/failed). The full
          internal ops view with per-stage detail lives on the <Link href="/monitor" className="font-bold text-primary hover:underline">Monitor</Link> page.
        </p>
      </CardBody>
    </Card>
  );
}
