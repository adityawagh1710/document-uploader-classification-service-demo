"use client";

import { useEffect, useState } from "react";
import { Mail, X, Paperclip, FileText, AlertTriangle, Hash, Layers, Copy } from "lucide-react";
import type { EmailExtractionResponse } from "@/lib/types";
import { Badge } from "@/components/ui/primitives";

/**
 * Email-extraction popup for the Documents page. Lazily fetches the cached
 * email-extraction-service (App Runner) response for a documentId from
 * /api/runs/[id]/email-extraction and presents it in a light Opus2 modal.
 *
 * 404 is expected and handled gracefully — the response is cached in-process
 * by the classify route, so it's lost on a UI restart / a different pod, or
 * for rows that predate the email fan-out.
 */

const BODY_LIMIT = 4000;

export function EmailExtractionModal({
  documentId,
  fileName,
  onClose,
}: {
  documentId: string;
  fileName?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<EmailExtractionResponse | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/runs/${documentId}/email-extraction`, { cache: "no-store" });
        if (res.status === 404) {
          if (!cancelled)
            setError(
              "No cached extraction for this document — it may have been classified in a previous session (the extraction cache is in-memory and lost on UI restart).",
            );
          return;
        }
        if (!res.ok) throw new Error(`extraction api ${res.status}`);
        const body = (await res.json()) as { extraction: EmailExtractionResponse };
        if (!cancelled) setExtraction(body.extraction);
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message ?? "failed to load extraction");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const attachments = extraction?.attachment_keys ?? [];
  const body = extraction?.body ?? "";
  const bodyTruncated = body.length > BODY_LIMIT;
  const bodyShown = bodyTruncated
    ? `${body.slice(0, BODY_LIMIT)}\n\n… (truncated, ${body.length - BODY_LIMIT} more chars)`
    : body;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      data-testid="email-extraction-modal"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <header className="flex items-center gap-3 border-b border-border bg-muted/40 px-5 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-button bg-primary/10 text-primary">
            <Mail className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-foreground">Email extraction</h3>
              <Badge tone="info">App Runner</Badge>
            </div>
            {fileName ? <p className="truncate text-xs text-muted-foreground">{fileName}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-button border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            data-testid="close-email-modal"
          >
            <span className="flex items-center gap-1">
              <X className="h-3.5 w-3.5" /> Esc
            </span>
          </button>
        </header>

        {/* body */}
        <div className="overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
              Loading extraction…
            </div>
          ) : error ? (
            <div className="rounded-button border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {error}
            </div>
          ) : extraction ? (
            <div className="space-y-4">
              {/* headline fields */}
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <KV label="Subject" value={extraction.subject ?? "—"} wide />
                <KV label="Body source" value={extraction.body_source ?? "—"} />
                <KV label="HTML" value={extraction.is_html ? "yes" : "no"} />
                <KV label="Tenant" value={extraction.tenant_id ?? "—"} />
                <KV label="Message ID" value={extraction.message_id ?? "—"} />
              </dl>

              {/* stat chips */}
              <div className="flex flex-wrap gap-2">
                <Stat icon={<Layers className="h-3 w-3" />} label="emitted" value={extraction.emitted_events ?? 0} />
                <Stat icon={<Hash className="h-3 w-3" />} label="nested" value={extraction.nested_emits ?? 0} />
                <Stat icon={<Paperclip className="h-3 w-3" />} label="attachments" value={attachments.length} />
                <Stat
                  icon={<AlertTriangle className="h-3 w-3" />}
                  label="attach failures"
                  value={extraction.attachment_failures ?? 0}
                  tone={(extraction.attachment_failures ?? 0) > 0 ? "warn" : "neutral"}
                />
                {extraction.depth_limited ? <Badge tone="warn">depth limited</Badge> : null}
                {extraction.duplicate_skipped ? <Badge tone="warn">duplicate skipped</Badge> : null}
              </div>

              {/* attachments */}
              {attachments.length > 0 ? (
                <section>
                  <SectionTitle icon={<Paperclip className="h-3.5 w-3.5" />}>
                    Attachment keys ({attachments.length})
                  </SectionTitle>
                  <ul className="space-y-1 rounded-button border border-border bg-muted/30 p-3">
                    {attachments.map((k) => (
                      <li key={k} className="break-all font-mono text-xs text-foreground">
                        {k}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* body */}
              {body ? (
                <section>
                  <SectionTitle icon={<FileText className="h-3.5 w-3.5" />}>
                    Body{extraction.is_html ? " · HTML (shown as text)" : ""}
                  </SectionTitle>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-button border border-border bg-muted/30 p-3 text-xs text-foreground">
                    {bodyShown}
                  </pre>
                </section>
              ) : null}

              {/* raw json */}
              <details>
                <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                  Raw JSON
                </summary>
                <div className="relative mt-2">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(JSON.stringify(extraction, null, 2))}
                    className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-button border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                    title="Copy JSON"
                  >
                    <Copy className="h-3 w-3" /> copy
                  </button>
                  <pre className="max-h-72 overflow-auto rounded-button border border-border bg-muted/30 p-3 text-xs text-foreground">
                    {JSON.stringify(extraction, null, 2)}
                  </pre>
                </div>
              </details>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No extraction data.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "warn";
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-button border px-2.5 py-1 text-xs " +
        (tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-border bg-muted/40 text-foreground")
      }
    >
      {icon}
      <span className="tabular-nums font-bold">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}
