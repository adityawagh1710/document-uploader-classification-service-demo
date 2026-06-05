import fc from "fast-check";
import type { ContentHashRecordInit } from "../../../src/adapters/dynamo-content-hashes/index.js";

const HEX = "0123456789abcdef";

export const sha256HexGen: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 })
  .map((digits) => digits.map((d) => HEX[d]).join(""));

export const isoTimestampGen: fc.Arbitrary<string> = fc
  .date({ min: new Date("2020-01-01T00:00:00.000Z"), max: new Date("2099-12-31T23:59:59.999Z") })
  .map((d) => d.toISOString());

export const formatGen: fc.Arbitrary<string> = fc.constantFrom("docx", "pdf", "msg", "eml", "txt", "tiff", "png", "html");

export const policyVersionGen: fc.Arbitrary<string> = fc.constantFrom("v1", "v2", "v3", "v4", "v5");

export const contentHashRecordInitGen: fc.Arbitrary<ContentHashRecordInit> = fc.record({
  workspaceId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.length > 0),
  contentHash: sha256HexGen,
  format: formatGen,
  policyVersion: policyVersionGen,
  firstDocumentId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.length > 0),
  now: isoTimestampGen,
  hashTtlDays: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 3650 })),
});

const DOCUMENTED_SDK_ERROR_NAMES = [
  "ConditionalCheckFailedException",
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
  "ResourceNotFoundException",
  "InternalServerError",
  "ServiceUnavailable",
  "TimeoutError",
  "AbortError",
] as const;

export const documentedSDKErrorGen: fc.Arbitrary<Error> = fc
  .constantFrom(...DOCUMENTED_SDK_ERROR_NAMES)
  .map((name) => {
    const e = new Error(`${name}: mocked`);
    e.name = name;
    return e;
  });

export { DOCUMENTED_SDK_ERROR_NAMES };
