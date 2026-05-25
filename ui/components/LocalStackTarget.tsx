"use client";

import { useEffect, useState } from "react";

interface Target {
  endpoint: string;
  region: string;
  bucket: string;
  contentHashTable: string;
  workspaceConfigTable: string;
  backend: "localstack" | "real-aws";
}

export function LocalStackTarget() {
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    fetch("/api/target")
      .then((r) => r.json() as Promise<Target>)
      .then(setTarget)
      .catch(() => undefined);
  }, []);

  if (!target) {
    return (
      <div className="rounded-lg border border-border-subtle bg-slate-900/40 p-4 text-xs text-slate-500">
        loading target…
      </div>
    );
  }

  const isLocalStack = target.backend === "localstack";
  const label = isLocalStack ? "LOCALSTACK TARGET" : "AWS TARGET";

  return (
    <div
      className="rounded-lg border border-border-subtle bg-slate-900/40 p-4 text-xs"
      data-testid="target-info"
    >
      <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-emerald-400">
        {label}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-400 font-mono">
        <Row label="endpoint" value={target.endpoint} />
        <Row label="region" value={target.region} />
        <Row label="source bucket" value={target.bucket} />
        <Row label="content-hash table" value={target.contentHashTable} />
        <Row label="workspace-config table" value={target.workspaceConfigTable} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}:</dt>
      <dd className="text-slate-300 break-all">{value}</dd>
    </>
  );
}
