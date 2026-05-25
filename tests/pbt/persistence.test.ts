import { describe, it } from "vitest";
import fc from "fast-check";
import {
  buildContentHashRecord,
  computeExpiresAt,
  serialiseRecord,
  deserialiseRecord,
} from "../../src/adapters/dynamo-content-hashes/index.js";
import { mapDDBError } from "../../src/adapters/shared/map-ddb-error.js";
import {
  contentHashRecordInitGen,
  isoTimestampGen,
  documentedSDKErrorGen,
} from "./generators/persistence.gen.js";

describe("PBT — Persistence", () => {
  it("PBT-U2-001 — buildContentHashRecord: invariant on every output", () => {
    fc.assert(
      fc.property(contentHashRecordInitGen, (init) => {
        const r = buildContentHashRecord(init);
        return (
          r.workspaceId === init.workspaceId &&
          r.contentHash === init.contentHash &&
          r.format === init.format &&
          r.policyVersion === init.policyVersion &&
          r.firstDocumentId === init.firstDocumentId &&
          r.firstSeenAt === init.now &&
          r.lastSeenAt === init.now &&
          r.hitCount === 0 &&
          (init.hashTtlDays === null ? r.expiresAt === undefined : typeof r.expiresAt === "number")
        );
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U2-002 — computeExpiresAt: equals floor(epochSeconds(firstSeenAt)) + ttlDays * 86400", () => {
    fc.assert(
      fc.property(isoTimestampGen, fc.integer({ min: 1, max: 3650 }), (iso, ttlDays) => {
        const actual = computeExpiresAt(iso, ttlDays);
        const expected = Math.floor(Date.parse(iso) / 1000) + ttlDays * 86_400;
        return actual === expected;
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U2-003 — serialise/deserialise round-trip is identity", () => {
    fc.assert(
      fc.property(contentHashRecordInitGen, (init) => {
        const original = buildContentHashRecord(init);
        const restored = deserialiseRecord(serialiseRecord(original));
        return JSON.stringify(restored) === JSON.stringify(original);
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U2-004 — mapDDBError totality: every documented SDK error name maps to non-'unknown'", () => {
    fc.assert(
      fc.property(documentedSDKErrorGen, (error) => {
        // ResourceNotFoundException is the one documented-but-"unknown" case (infra issue).
        // For all OTHER documented errors, the mapping must NOT be "unknown".
        const mapped = mapDDBError(error);
        if (error.name === "ResourceNotFoundException") {
          return mapped === "unknown";
        }
        return mapped !== "unknown";
      }),
      { numRuns: 100 },
    );
  });
});
