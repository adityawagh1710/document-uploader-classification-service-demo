"use client";

/**
 * Client-side "selected workspace" state, mirroring the Figma prototype's
 * sessionStorage handoff between the Workspaces hub and the Document Transfer
 * wizard. This is purely a UI convenience — the authoritative workspace
 * records live in the workspace-config DynamoDB table (see /api/workspaces).
 */

const KEY = "opus2.selectedWorkspace";

export interface SelectedWorkspace {
  workspaceId: string;
  policyVersion?: string;
}

export function setSelectedWorkspace(ws: SelectedWorkspace): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(ws));
}

export function getSelectedWorkspace(): SelectedWorkspace | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SelectedWorkspace;
  } catch {
    return null;
  }
}

export function clearSelectedWorkspace(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}
