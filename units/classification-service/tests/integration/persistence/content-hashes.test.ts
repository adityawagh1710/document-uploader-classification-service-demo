import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { silentLogger } from "../../../src/ports/Logger.js";
import {
  createDDBContentHashAdapter,
  buildContentHashRecord,
} from "../../../src/adapters/dynamo-content-hashes/index.js";
import type { ContentHashStore } from "../../../src/ports/ContentHashStore.js";
import { getLocalstack } from "../_helpers.js";

let workspaceId: string;
let store: ContentHashStore;

beforeEach(() => {
  const { ddb, contentHashTable } = getLocalstack();
  workspaceId = `test-${randomUUID()}`;
  store = createDDBContentHashAdapter({
    ddb,
    tableName: contentHashTable,
    logger: silentLogger,
  });
});

const baseInit = () => ({
  workspaceId,
  contentHash: "abc123",
  format: "docx",
  policyVersion: "v1",
  firstDocumentId: "doc-1",
  now: "2026-05-22T10:00:00.000Z",
  hashTtlDays: null as number | null,
});

describe("DDBContentHashAdapter (integration)", () => {
  it("putIfAbsent → 'written' on first write", async () => {
    const record = buildContentHashRecord(baseInit());
    const result = await store.putIfAbsent(record);
    expect(result).toEqual({ ok: true, value: "written" });
  });

  it("putIfAbsent → 'already-existed' on race / duplicate", async () => {
    const record = buildContentHashRecord(baseInit());
    await store.putIfAbsent(record);
    const second = await store.putIfAbsent(record);
    expect(second).toEqual({ ok: true, value: "already-existed" });
  });

  it("get returns the written record", async () => {
    const record = buildContentHashRecord(baseInit());
    await store.putIfAbsent(record);
    const read = await store.get({ workspaceId, contentHash: record.contentHash });
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toEqual(record);
  });

  it("get returns null for missing key", async () => {
    const read = await store.get({ workspaceId, contentHash: "nonexistent" });
    expect(read).toEqual({ ok: true, value: null });
  });

  it("updateOnDuplicateHit increments hitCount and refreshes lastSeenAt", async () => {
    const record = buildContentHashRecord(baseInit());
    await store.putIfAbsent(record);

    const later = "2026-05-22T11:00:00.000Z";
    const update = await store.updateOnDuplicateHit({ workspaceId, contentHash: record.contentHash, now: later });
    expect(update.ok).toBe(true);

    const read = await store.get({ workspaceId, contentHash: record.contentHash });
    expect(read.ok).toBe(true);
    if (read.ok && read.value) {
      expect(read.value.hitCount).toBe(1);
      expect(read.value.lastSeenAt).toBe(later);
      expect(read.value.firstSeenAt).toBe(record.firstSeenAt);
      expect(read.value.format).toBe(record.format);
      expect(read.value.policyVersion).toBe(record.policyVersion);
    }
  });

  it("updateOnDuplicateHit on a vanished record returns conditional-check-failed", async () => {
    const later = "2026-05-22T11:00:00.000Z";
    // No prior put — the row does not exist
    const result = await store.updateOnDuplicateHit({ workspaceId, contentHash: "vanished", now: later });
    expect(result).toEqual({ ok: false, error: "conditional-check-failed" });
  });

  it("replaceOnPolicyMismatch overwrites when expected policyVersion matches", async () => {
    const original = buildContentHashRecord({ ...baseInit(), policyVersion: "v1" });
    await store.putIfAbsent(original);

    const refreshed = buildContentHashRecord({ ...baseInit(), policyVersion: "v2", now: "2026-05-22T12:00:00.000Z" });
    const result = await store.replaceOnPolicyMismatch({
      record: refreshed,
      expectedStalePolicyVersion: "v1",
    });
    expect(result.ok).toBe(true);

    const read = await store.get({ workspaceId, contentHash: refreshed.contentHash });
    expect(read.ok).toBe(true);
    if (read.ok && read.value) {
      expect(read.value.policyVersion).toBe("v2");
      expect(read.value.hitCount).toBe(0);
      expect(read.value.firstSeenAt).toBe(refreshed.firstSeenAt);
    }
  });

  it("replaceOnPolicyMismatch returns conditional-check-failed on stale-version mismatch", async () => {
    const original = buildContentHashRecord({ ...baseInit(), policyVersion: "v1" });
    await store.putIfAbsent(original);

    const refreshed = buildContentHashRecord({ ...baseInit(), policyVersion: "v2" });
    const result = await store.replaceOnPolicyMismatch({
      record: refreshed,
      expectedStalePolicyVersion: "v999",
    });
    expect(result).toEqual({ ok: false, error: "conditional-check-failed" });
  });

  it("NFR-4: cross-workspace isolation — write to A is invisible to get against B", async () => {
    const wsA = `test-${randomUUID()}`;
    const wsB = `test-${randomUUID()}`;
    const recordA = buildContentHashRecord({ ...baseInit(), workspaceId: wsA, contentHash: "shared" });
    await store.putIfAbsent(recordA);

    const fromB = await store.get({ workspaceId: wsB, contentHash: "shared" });
    expect(fromB).toEqual({ ok: true, value: null });
  });

  it("TTL: expiresAt is set when hashTtlDays !== null", async () => {
    const record = buildContentHashRecord({ ...baseInit(), hashTtlDays: 30 });
    await store.putIfAbsent(record);
    const read = await store.get({ workspaceId, contentHash: record.contentHash });
    expect(read.ok).toBe(true);
    if (read.ok && read.value) {
      expect(read.value.expiresAt).toBeDefined();
      expect(typeof read.value.expiresAt).toBe("number");
    }
  });

  it("TTL: expiresAt is omitted when hashTtlDays is null", async () => {
    const record = buildContentHashRecord({ ...baseInit(), hashTtlDays: null });
    await store.putIfAbsent(record);
    const read = await store.get({ workspaceId, contentHash: record.contentHash });
    expect(read.ok).toBe(true);
    if (read.ok && read.value) {
      expect(read.value.expiresAt).toBeUndefined();
    }
  });
});
