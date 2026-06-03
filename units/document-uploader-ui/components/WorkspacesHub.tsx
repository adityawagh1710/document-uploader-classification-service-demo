"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus, Search, ShieldCheck, Lock } from "lucide-react";
import type { WorkspaceConfig } from "@/lib/types";
import { Button, Card, CardBody, Badge, Input } from "@/components/ui/primitives";
import { setSelectedWorkspace } from "@/lib/ui-workspace";

/**
 * Workspaces hub — the landing page. Lists the real workspace-config rows from
 * DynamoDB (GET /api/workspaces), supports creating a new workspace
 * (POST /api/workspaces), and hands the chosen workspace to the Document
 * Transfer wizard via sessionStorage. Mirrors the Figma prototype's workspace
 * grid, wired to the live backend.
 */
export function WorkspacesHub() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newId, setNewId] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/workspaces", { cache: "no-store" });
      if (!res.ok) throw new Error(`workspaces api ${res.status}`);
      const body = (await res.json()) as { workspaces: WorkspaceConfig[] };
      setWorkspaces(body.workspaces ?? []);
    } catch (e) {
      setError((e as Error)?.message ?? "failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? workspaces.filter((w) => w.workspaceId.toLowerCase().includes(q))
      : workspaces;
    return [...list].sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
  }, [workspaces, search]);

  const open = (w: WorkspaceConfig) => {
    setSelectedWorkspace({ workspaceId: w.workspaceId, policyVersion: w.policyVersion });
    router.push("/document-transfer");
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = newId.trim();
    if (!id) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `create failed (${res.status})`);
      }
      setNewId("");
      await load();
    } catch (e) {
      setError((e as Error)?.message ?? "failed to create workspace");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-normal text-foreground">Workspaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a workspace to transfer documents into, or create a new one. Backed by the
            live <code className="rounded bg-muted px-1">workspace-config</code> table.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workspaces…"
            className="w-64 pl-8"
          />
        </div>
      </div>

      {/* Create */}
      <Card>
        <CardBody>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
                New workspace ID
              </label>
              <Input
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="e.g. wks-acme-001"
              />
            </div>
            <Button type="submit" disabled={creating || !newId.trim()}>
              <Plus className="h-4 w-4" />
              {creating ? "Creating…" : "Create workspace"}
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Created with default policy (threshold 0.5, maxZipDepth 5, quarantine-macros off). Tune
            it in <span className="font-bold">Admin Config</span>.
          </p>
        </CardBody>
      </Card>

      {error ? (
        <div className="rounded-button border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading workspaces…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">
              {search ? "No workspaces match your search." : "No workspaces yet — create one above."}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((w) => {
            const ruleCount = Object.keys(w.slipsheetRules ?? {}).length;
            return (
              <Card key={w.workspaceId} className="flex flex-col transition-shadow hover:shadow-md">
                <CardBody className="flex flex-1 flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-button bg-primary/10 text-primary">
                        <FolderOpen className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="font-bold text-foreground">{w.workspaceId}</div>
                        <div className="text-xs text-muted-foreground">
                          policy {w.policyVersion}
                        </div>
                      </div>
                    </div>
                    {w.quarantineMacros ? (
                      <Badge tone="warn" title="Macro-enabled formats are quarantined to slipsheet">
                        <ShieldCheck className="h-3 w-3" /> macros
                      </Badge>
                    ) : null}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Threshold</dt>
                    <dd className="text-right tabular-nums">{w.threshold}</dd>
                    <dt className="text-muted-foreground">Max ZIP depth</dt>
                    <dd className="text-right tabular-nums">{w.maxZipDepth}</dd>
                    <dt className="text-muted-foreground">Slipsheet rules</dt>
                    <dd className="text-right tabular-nums">{ruleCount}</dd>
                    <dt className="text-muted-foreground">Hash TTL</dt>
                    <dd className="text-right tabular-nums">
                      {w.hashTtlDays == null ? "—" : `${w.hashTtlDays}d`}
                    </dd>
                  </dl>

                  <div className="mt-auto flex items-center gap-2 pt-2">
                    <Button className="flex-1" onClick={() => open(w)}>
                      Transfer documents
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        Shared vs. private destinations are a future capability — all workspaces currently behave the
        same in the backend.
      </p>
    </div>
  );
}
