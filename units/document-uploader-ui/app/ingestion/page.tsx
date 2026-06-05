"use client";

/**
 * Ingestion (GraphQL) — proves Approach A end to end through the real UI stack:
 * this page talks GraphQL to the Go wundergraph-router (not the in-process
 * /api/* routes). Flow: list/create workspace -> create document (presigned
 * claim-check upload URL) -> classify (dispatch StageRequest) -> poll status.
 *
 * The existing pages are unchanged; per-page migration onto this client is the
 * incremental rollout (gated by NEXT_PUBLIC_INGESTION_GRAPHQL_URL).
 */

import { useCallback, useEffect, useState } from "react";
import {
  classifyDocument,
  createDocument,
  createWorkspace,
  getDocument,
  ingestionEndpoint,
  listWorkspaces,
  stats,
  type CreateDocumentResult,
  type Document,
  type Workspace,
} from "@/lib/ingestion-graphql";

export default function IngestionPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [filename, setFilename] = useState<string>("contract.docx");
  const [created, setCreated] = useState<CreateDocumentResult | null>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [counts, setCounts] = useState<{ workspaces: number; documents: number } | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [ws, st] = await Promise.all([listWorkspaces(), stats()]);
      setWorkspaces(ws);
      setCounts(st);
      if (!selected && ws.length > 0) setSelected(ws[0].id);
    } catch (e) {
      setError(String(e));
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll the document status (the router also exposes a real graphql-transport-ws
  // subscription; polling keeps the POC page dependency-free).
  useEffect(() => {
    if (!doc) return;
    const t = setInterval(async () => {
      try {
        const latest = await getDocument(doc.id);
        if (latest) setDoc(latest);
      } catch {
        /* ignore transient poll errors */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [doc]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 820, margin: "32px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Ingestion (GraphQL)</h1>
      <p style={{ color: "#555" }}>
        Talking GraphQL to the wundergraph-router at <code>{ingestionEndpoint()}</code>.
      </p>
      {error && (
        <p style={{ background: "#fde8e8", color: "#9b1c1c", padding: 10, borderRadius: 6 }}>{error}</p>
      )}

      <section style={card}>
        <h2>1 · Workspace</h2>
        <button disabled={busy} onClick={() => run(async () => { await createWorkspace(7); await refresh(); })}>
          + Create workspace
        </button>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ marginLeft: 10 }}>
          <option value="">— select —</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.id} ({w.status})</option>
          ))}
        </select>
      </section>

      <section style={card}>
        <h2>2 · Create document (presigned claim-check)</h2>
        <input value={filename} onChange={(e) => setFilename(e.target.value)} style={{ width: 260 }} />
        <button
          disabled={busy || !selected}
          style={{ marginLeft: 10 }}
          onClick={() => run(async () => {
            const r = await createDocument(selected, filename);
            setCreated(r);
            setDoc(r.document);
            await refresh();
          })}
        >
          Create + presign
        </button>
        {created && (
          <p style={{ fontSize: 12, wordBreak: "break-all", color: "#555" }}>
            <strong>uploadUrl:</strong> {created.uploadUrl}
          </p>
        )}
      </section>

      <section style={card}>
        <h2>3 · Classify (dispatch StageRequest) + live status</h2>
        <button
          disabled={busy || !doc}
          onClick={() => run(async () => { if (doc) setDoc(await classifyDocument(doc.id)); })}
        >
          Classify
        </button>
        {doc && (
          <p>
            <strong>{doc.filename}</strong> — status <code>{doc.status}</code>
            {doc.pipelineStage ? <> · stage <code>{doc.pipelineStage}</code></> : null}
          </p>
        )}
      </section>

      <section style={card}>
        <h2>Stats</h2>
        {counts ? <p>workspaces: {counts.workspaces} · documents: {counts.documents}</p> : <p>—</p>}
      </section>
    </main>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  padding: 16,
  margin: "16px 0",
};
