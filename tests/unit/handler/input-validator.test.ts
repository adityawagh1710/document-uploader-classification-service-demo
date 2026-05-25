import { describe, it, expect } from "vitest";
import { createInputValidator } from "../../../src/application/index.js";

const validPayload = {
  taskToken: "token-1",
  workspaceId: "ws-1",
  documentId: "doc-1",
  s3: { bucket: "bucket", key: "key" },
  hints: { extension: "pdf", contentType: null },
  context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
};

describe("InputValidator", () => {
  const validator = createInputValidator();

  it("accepts a valid payload", () => {
    const result = validator.validate(validPayload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject(validPayload);
  });

  it("passes through unknown extra fields (Q1=A)", () => {
    const result = validator.validate({ ...validPayload, futureField: "abc" });
    expect(result.ok).toBe(true);
  });

  it("rejects empty taskToken", () => {
    const result = validator.validate({ ...validPayload, taskToken: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("taskToken");
  });

  it("rejects missing workspaceId", () => {
    const { workspaceId: _omit, ...withoutWorkspaceId } = validPayload;
    const result = validator.validate(withoutWorkspaceId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("workspaceId");
  });

  it("rejects negative parentArchiveDepth", () => {
    const result = validator.validate({
      ...validPayload,
      context: { parentArchiveDepth: -1, overrideDuplicateCheck: false },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects malformed s3 object", () => {
    const result = validator.validate({ ...validPayload, s3: { bucket: "bucket" } });
    expect(result.ok).toBe(false);
  });
});
