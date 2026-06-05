import type { ContentHashRecord } from "../../../shared/types.js";

// DDB Document Client item shape — we keep this loose because the Document Client
// handles AttributeValue marshalling for us.
type DDBItem = Record<string, unknown>;

// Pure: ContentHashRecord -> DDB item (round-trippable via deserialiseRecord).
export function serialiseRecord(record: ContentHashRecord): DDBItem {
  const item: DDBItem = {
    workspaceId: record.workspaceId,
    contentHash: record.contentHash,
    firstSeenAt: record.firstSeenAt,
    firstDocumentId: record.firstDocumentId,
    format: record.format,
    policyVersion: record.policyVersion,
    lastSeenAt: record.lastSeenAt,
    hitCount: record.hitCount,
  };
  if (record.expiresAt !== undefined) item.expiresAt = record.expiresAt;
  return item;
}

// Pure: DDB item -> ContentHashRecord. Inverse of serialiseRecord on well-formed items.
// Returns null when the item is missing required fields (defensive — should not happen
// for items we wrote ourselves; protects against corruption).
export function deserialiseRecord(item: DDBItem): ContentHashRecord | null {
  const workspaceId = stringOrNull(item.workspaceId);
  const contentHash = stringOrNull(item.contentHash);
  const firstSeenAt = stringOrNull(item.firstSeenAt);
  const firstDocumentId = stringOrNull(item.firstDocumentId);
  const format = stringOrNull(item.format);
  const policyVersion = stringOrNull(item.policyVersion);
  const lastSeenAt = stringOrNull(item.lastSeenAt);
  const hitCount = numberOrNull(item.hitCount);

  if (
    workspaceId === null || contentHash === null || firstSeenAt === null ||
    firstDocumentId === null || format === null || policyVersion === null ||
    lastSeenAt === null || hitCount === null
  ) {
    return null;
  }

  const base: ContentHashRecord = {
    workspaceId,
    contentHash,
    firstSeenAt,
    firstDocumentId,
    format,
    policyVersion,
    lastSeenAt,
    hitCount,
  };

  const expiresAt = numberOrNull(item.expiresAt);
  if (expiresAt !== null) return { ...base, expiresAt };
  return base;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
