"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, Plus, X, CheckCircle2, SlidersHorizontal } from "lucide-react";
import type { WorkspaceConfig } from "@/lib/types";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Badge,
  Input,
  Select,
  Checkbox,
  FieldLabel,
  MockStub,
} from "@/components/ui/primitives";

/**
 * Admin Config — edit the real classifier policy stored in workspace-config
 * (threshold, maxZipDepth, quarantineMacros, slipsheetRules, hashTtlDays) via
 * GET/POST /api/workspaces. Conversion-rule / email / OCR sections from the
 * Figma prototype are rendered as clearly-labelled, non-functional stubs
 * because no backend in this stack persists them.
 */

type SaveState = "idle" | "saving" | "saved";

const MACRO_FORMATS = ["docm", "xlsm", "pptm"];
const COMMON_FORMATS = ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "zip", "dwg", "tiff"];

export function AdminConfig() {
  const [workspaces, setWorkspaces] = useState<WorkspaceConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<WorkspaceConfig | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces", { cache: "no-store" });
      if (!res.ok) throw new Error(`workspaces api ${res.status}`);
      const body = (await res.json()) as { workspaces: WorkspaceConfig[] };
      setWorkspaces(body.workspaces ?? []);
      if (!selectedId && body.workspaces?.length) {
        setSelectedId(body.workspaces[0].workspaceId);
      }
    } catch (e) {
      setError((e as Error)?.message ?? "failed to load workspaces");
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ws = workspaces.find((w) => w.workspaceId === selectedId);
    setDraft(ws ? { ...ws, slipsheetRules: { ...(ws.slipsheetRules ?? {}) } } : null);
    setSaveState("idle");
  }, [selectedId, workspaces]);

  const patch = (p: Partial<WorkspaceConfig>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setSaveState("idle");
  };

  const addRule = () => {
    const f = newRule.trim().toLowerCase();
    if (!f || !draft) return;
    patch({ slipsheetRules: { ...draft.slipsheetRules, [f]: "always-slipsheet" } });
    setNewRule("");
  };

  const removeRule = (f: string) => {
    if (!draft) return;
    const next = { ...draft.slipsheetRules };
    delete next[f];
    patch({ slipsheetRules: next });
  };

  const save = async () => {
    if (!draft) return;
    setSaveState("saving");
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `save failed (${res.status})`);
      }
      setSaveState("saved");
      await load();
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (e) {
      setError((e as Error)?.message ?? "save failed");
      setSaveState("idle");
    }
  };

  const ruleFormats = draft ? Object.keys(draft.slipsheetRules ?? {}) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-normal text-foreground">Admin Config</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-workspace classifier policy. Stored in the live{" "}
            <code className="rounded bg-muted px-1">workspace-config</code> table.
          </p>
        </div>
        <div className="w-64">
          <FieldLabel>Workspace</FieldLabel>
          <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {workspaces.length === 0 ? <option value="">No workspaces</option> : null}
            {workspaces.map((w) => (
              <option key={w.workspaceId} value={w.workspaceId}>
                {w.workspaceId}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error ? (
        <div className="rounded-button border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {!draft ? (
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">
              Select a workspace to edit its policy, or create one on the Workspaces page.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          {/* ── Real: classifier policy ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" /> Classifier policy
                <Badge tone="success" className="ml-2">live</Badge>
              </CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Policy version</FieldLabel>
                <Input value={draft.policyVersion} onChange={(e) => patch({ policyVersion: e.target.value })} />
              </div>
              <div>
                <FieldLabel>Confidence threshold (0–1)</FieldLabel>
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  value={draft.threshold}
                  onChange={(e) => patch({ threshold: Number(e.target.value) })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Scores at/below this force a low-confidence slipsheet.
                </p>
              </div>
              <div>
                <FieldLabel>Max ZIP depth</FieldLabel>
                <Input
                  type="number"
                  min={0}
                  value={draft.maxZipDepth}
                  onChange={(e) => patch({ maxZipDepth: Number(e.target.value) })}
                />
              </div>
              <div>
                <FieldLabel>Hash TTL (days, blank = none)</FieldLabel>
                <Input
                  type="number"
                  min={0}
                  value={draft.hashTtlDays ?? ""}
                  onChange={(e) => patch({ hashTtlDays: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
              <label className="flex items-center gap-2 md:col-span-2">
                <Checkbox
                  checked={draft.quarantineMacros}
                  onChange={(e) => patch({ quarantineMacros: e.target.checked })}
                />
                <span className="text-sm text-foreground">
                  Quarantine macro-enabled formats ({MACRO_FORMATS.join(", ")}) to slipsheet
                </span>
              </label>

              {/* slipsheet rules */}
              <div className="md:col-span-2">
                <FieldLabel>Always-slipsheet formats</FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  {ruleFormats.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No per-format rules.</span>
                  ) : (
                    ruleFormats.map((f) => (
                      <Badge key={f} tone="warn" className="gap-1">
                        {f}
                        <button type="button" onClick={() => removeRule(f)} className="hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    list="common-formats"
                    value={newRule}
                    onChange={(e) => setNewRule(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addRule();
                      }
                    }}
                    placeholder="add format e.g. dwg"
                    className="w-48"
                  />
                  <datalist id="common-formats">
                    {COMMON_FORMATS.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                  <Button variant="outline" size="sm" onClick={addRule} disabled={!newRule.trim()}>
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saveState === "saving"}>
              {saveState === "saving" ? (
                "Saving…"
              ) : saveState === "saved" ? (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Saved
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" /> Save policy
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              Writes the full config row for <span className="font-bold">{draft.workspaceId}</span>.
            </span>
          </div>

          {/* ── Mock: ingestion rules not backed by this stack ── */}
          <Card className="opacity-95">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Ingestion rules
                <MockStub label="Preview only" detail="not persisted by this stack" className="ml-2" />
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-5">
              <fieldset disabled className="space-y-5">
                <div>
                  <FieldLabel>Conversion formats → PDF</FieldLabel>
                  <div className="flex flex-wrap gap-3">
                    {["DOC", "DOCX", "XLS", "XLSX", "PPT", "PPTX", "TXT", "RTF", "JPG", "PNG", "TIFF"].map((f) => (
                      <label key={f} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Checkbox defaultChecked readOnly />
                        {f}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <FieldLabel>Email handling</FieldLabel>
                  <div className="flex flex-wrap gap-3">
                    {["Convert to PDF", "Extract attachments", "Include headers", "Preserve threading"].map((f) => (
                      <label key={f} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Checkbox defaultChecked readOnly />
                        {f}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel>OCR mode</FieldLabel>
                    <Select defaultValue="if-required">
                      <option value="if-required">If required</option>
                      <option value="always">Always</option>
                      <option value="never">Never</option>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel>OCR language</FieldLabel>
                    <Select defaultValue="en">
                      <option value="en">English</option>
                    </Select>
                  </div>
                </div>
              </fieldset>
              <p className="text-xs text-muted-foreground">
                These map to downstream services (office-convert, email-extraction, an OCR engine) that
                aren&apos;t configured through this table yet. Shown for parity with the product design.
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
