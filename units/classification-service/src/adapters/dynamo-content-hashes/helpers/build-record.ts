import type { ContentHashRecord } from "../../../shared/types.js";
import { computeExpiresAt } from "./compute-expires-at.js";

export interface ContentHashRecordInit {
  readonly workspaceId: string;
  readonly contentHash: string;
  readonly format: string;
  readonly policyVersion: string;
  readonly firstDocumentId: string;
  readonly now: string;
  readonly hashTtlDays: number | null;
}

// Pure factory: produces a fresh record with `firstSeenAt === lastSeenAt === now`
// and `hitCount === 0`. `expiresAt` present iff `hashTtlDays !== null`.
// Verified by PBT-U2-001.
export function buildContentHashRecord(init: ContentHashRecordInit): ContentHashRecord {
  const base: ContentHashRecord = {
    workspaceId: init.workspaceId,
    contentHash: init.contentHash,
    firstSeenAt: init.now,
    firstDocumentId: init.firstDocumentId,
    format: init.format,
    policyVersion: init.policyVersion,
    lastSeenAt: init.now,
    hitCount: 0,
  };

  if (init.hashTtlDays === null) return base;

  return { ...base, expiresAt: computeExpiresAt(init.now, init.hashTtlDays) };
}
