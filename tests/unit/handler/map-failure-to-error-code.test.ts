import { describe, it, expect } from "vitest";
import {
  mapFailureToErrorCode,
  isTransientOrThrottled,
} from "../../../src/application/index.js";
import type { ClassificationFailure } from "../../../src/application/index.js";

describe("mapFailureToErrorCode", () => {
  it.each([
    [{ kind: "input-validation", field: "s3.bucket", message: "Required" }, "INPUT_VALIDATION_FAILED"],
    [{ kind: "s3", reason: "object-not-found" }, "S3_OBJECT_NOT_FOUND"],
    [{ kind: "s3", reason: "access-denied" }, "S3_ACCESS_DENIED"],
    [{ kind: "s3", reason: "transient" }, "S3_TRANSIENT"],
    [{ kind: "s3", reason: "throttled" }, "S3_THROTTLED"],
    [{ kind: "s3", reason: "unknown" }, "INTERNAL_ERROR"],
    [{ kind: "store", reason: "not-found" }, "WORKSPACE_NOT_FOUND"],
    [{ kind: "store", reason: "conditional-check-failed" }, "DDB_CONDITION_FAILED"],
    [{ kind: "store", reason: "throttled" }, "DDB_THROTTLED"],
    [{ kind: "store", reason: "transient" }, "DDB_TRANSIENT"],
    [{ kind: "store", reason: "unknown" }, "INTERNAL_ERROR"],
    [{ kind: "signal", reason: "task-not-found" }, "SIGNAL_ERROR"],
    [{ kind: "signal", reason: "transient" }, "SIGNAL_ERROR"],
    [{ kind: "signal", reason: "unknown" }, "SIGNAL_ERROR"],
    [{ kind: "unexpected", message: "boom" }, "UNEXPECTED_ERROR"],
  ] as ReadonlyArray<[ClassificationFailure, string]>)(
    "maps %s -> %s",
    (failure, expectedCode) => {
      const result = mapFailureToErrorCode(failure);
      expect(result.code).toBe(expectedCode);
      expect(result.message).toBeTypeOf("string");
      expect(result.message.length).toBeGreaterThan(0);
    },
  );
});

describe("isTransientOrThrottled", () => {
  it.each([
    [{ kind: "s3", reason: "transient" }, true],
    [{ kind: "s3", reason: "throttled" }, true],
    [{ kind: "store", reason: "transient" }, true],
    [{ kind: "store", reason: "throttled" }, true],
    [{ kind: "s3", reason: "object-not-found" }, false],
    [{ kind: "store", reason: "conditional-check-failed" }, false],
    [{ kind: "input-validation", field: "f", message: "m" }, false],
    [{ kind: "unexpected", message: "boom" }, false],
  ] as ReadonlyArray<[ClassificationFailure, boolean]>)(
    "%s -> %s",
    (failure, expected) => {
      expect(isTransientOrThrottled(failure)).toBe(expected);
    },
  );
});
