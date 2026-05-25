"use client";

import { useState } from "react";

export function WorkspaceForm({ onSeeded }: { onSeeded?: () => void }) {
  const [workspaceId, setWorkspaceId] = useState("wks-ui-001");
  const [threshold, setThreshold] = useState("0.5");
  const [maxZipDepth, setMaxZipDepth] = useState("5");
  const [quarantineMacros, setQuarantineMacros] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const resp = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          policyVersion: "v1",
          threshold: Number(threshold),
          maxZipDepth: Number(maxZipDepth),
          quarantineMacros,
          slipsheetRules: {},
          hashTtlDays: null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErr(data?.error ?? "failed");
      } else {
        setMsg(`Seeded ${workspaceId}`);
        onSeeded?.();
      }
    } catch (e: unknown) {
      setErr((e as Error)?.message ?? "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-border-subtle bg-slate-900/40 p-4 grid grid-cols-2 gap-3 text-sm"
    >
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-[10.5px] uppercase tracking-[0.1em] text-slate-400 font-semibold">
          Workspace ID
        </span>
        <input
          type="text"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          placeholder="e.g. wks-ui-001"
          className="rounded border border-border-subtle bg-slate-950/40 px-3 py-2 tabular-nums placeholder:text-slate-600"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] uppercase tracking-[0.1em] text-slate-400 font-semibold">
          Threshold (0–1)
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="rounded border border-border-subtle bg-slate-950/40 px-3 py-2 tabular-nums"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] uppercase tracking-[0.1em] text-slate-400 font-semibold">
          Max ZIP depth
        </span>
        <input
          type="number"
          min="0"
          value={maxZipDepth}
          onChange={(e) => setMaxZipDepth(e.target.value)}
          className="rounded border border-border-subtle bg-slate-950/40 px-3 py-2 tabular-nums"
        />
      </label>
      <label className="col-span-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={quarantineMacros}
          onChange={(e) => setQuarantineMacros(e.target.checked)}
        />
        <span className="text-slate-300">quarantineMacros (docm/xlsm/pptm → slipsheet)</span>
      </label>
      <div className="col-span-2 flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-emerald-600/80 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Seed workspace"}
        </button>
        {msg ? <span className="text-xs text-emerald-400">{msg}</span> : null}
        {err ? <span className="text-xs text-red-400">{err}</span> : null}
      </div>
    </form>
  );
}
