import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHandler } from "../src/handler.js";
import { createLogger } from "../src/logger.js";
import type { OfficeConvertClient, ConvertOutcome } from "../src/office-convert-client.js";
import type { DdbUpdater } from "../src/ddb-update.js";
import type { ConvertClaim } from "../src/message.js";
import { noopTaskSignaler } from "../src/task-signaler.js";

const CLAIM: ConvertClaim = {
  pipelineExecutionId: "doc-abc",
  tenantId: "wks-001",
  documentId: "doc-abc",
  runId: "2026-05-28T12:00:00.000Z#doc-abc",
  sourceBucket: "classification-ui-dev05",
  sourceKey: "ui/doc-abc/invoice.docx",
  filename: "invoice.docx",
  subCategory: "office",
  correlationId: "corr-xyz",
};

function silentLogger() {
  return createLogger({ level: "error", sink: () => {} });
}

function fakeOfficeConvert(outcome: ConvertOutcome): OfficeConvertClient & {
  convert: ReturnType<typeof vi.fn>;
} {
  const convert = vi.fn().mockResolvedValue(outcome);
  return { convert };
}

function fakeDdb(): DdbUpdater & Record<"markConverting" | "markDone" | "markFailed", ReturnType<typeof vi.fn>> {
  return {
    markConverting: vi.fn().mockResolvedValue(undefined),
    markDone: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
}

function build(outcome: ConvertOutcome, opts: { excludeDwg?: boolean } = {}) {
  const officeConvert = fakeOfficeConvert(outcome);
  const ddb = fakeDdb();
  const handler = createHandler({
    officeConvert,
    ddb,
    logger: silentLogger(),
    excludeDwg: opts.excludeDwg ?? true,
    outputBucket: (c) => c.sourceBucket,
    outputKey: (c) => `converted/${c.documentId}.pdf`,
    taskSignaler: noopTaskSignaler,
  });
  return { handler, officeConvert, ddb };
}

describe("handler", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("happy path", () => {
    it("marks converting then done and deletes the message", async () => {
      const { handler, officeConvert, ddb } = build({
        kind: "success",
        status: 200,
        requestId: "rid-1",
        outputBucket: "classification-ui-dev05",
        outputKey: "converted/doc-abc.pdf",
      });

      const disposition = await handler({ claim: CLAIM, attempts: 1 });

      expect(disposition).toBe("delete");
      expect(officeConvert.convert).toHaveBeenCalledWith({
        s3Input: "s3://classification-ui-dev05/ui/doc-abc/invoice.docx",
        s3Output: "s3://classification-ui-dev05/converted/doc-abc.pdf",
        correlationId: "corr-xyz",
      });
      expect(ddb.markConverting).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ workspaceId: "wks-001", runId: CLAIM.runId, attempts: 1 }),
      );
      expect(ddb.markDone).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          workspaceId: "wks-001",
          runId: CLAIM.runId,
          s3Bucket: "classification-ui-dev05",
          s3Key: "converted/doc-abc.pdf",
          requestId: "rid-1",
        }),
      );
      expect(ddb.markFailed).not.toHaveBeenCalled();
    });
  });

  describe("caller-error (4xx) path", () => {
    it("marks failed and deletes the message — no retry", async () => {
      const { handler, ddb } = build({
        kind: "caller_error",
        status: 400,
        failureClass: "unsupported_format",
        detail: "DWG inputs not supported",
        requestId: "rid-2",
      });

      const disposition = await handler({ claim: CLAIM, attempts: 1 });

      expect(disposition).toBe("delete");
      expect(ddb.markFailed).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          workspaceId: "wks-001",
          runId: CLAIM.runId,
          error: "office_convert_400:unsupported_format",
          requestId: "rid-2",
        }),
      );
      expect(ddb.markDone).not.toHaveBeenCalled();
    });
  });

  describe("server-error (5xx) path", () => {
    it("redrives without marking failed (DLQ-fed watchdog owns the terminal flip)", async () => {
      const { handler, ddb } = build({
        kind: "server_error",
        status: 500,
        failureClass: "render_failed",
        detail: "Aspose subdivision floor exceeded",
      });

      const disposition = await handler({ claim: CLAIM, attempts: 2 });

      expect(disposition).toBe("redrive");
      expect(ddb.markConverting).toHaveBeenCalled();
      expect(ddb.markDone).not.toHaveBeenCalled();
      expect(ddb.markFailed).not.toHaveBeenCalled();
    });
  });

  describe("network-error path", () => {
    it("redrives", async () => {
      const { handler, ddb } = build({ kind: "network_error", cause: "ECONNREFUSED" });
      const disposition = await handler({ claim: CLAIM, attempts: 1 });
      expect(disposition).toBe("redrive");
      expect(ddb.markFailed).not.toHaveBeenCalled();
    });
  });

  describe("timeout path", () => {
    it("redrives", async () => {
      const { handler, ddb } = build({ kind: "timeout", afterMs: 1_800_000 });
      const disposition = await handler({ claim: CLAIM, attempts: 3 });
      expect(disposition).toBe("redrive");
      expect(ddb.markFailed).not.toHaveBeenCalled();
    });
  });

  describe("DWG short-circuit", () => {
    it("marks failed with format_unsupported:dwg without calling office-convert", async () => {
      const { handler, officeConvert, ddb } = build({
        kind: "success",
        status: 200,
        requestId: "would-not-reach",
      });
      const dwgClaim: ConvertClaim = {
        ...CLAIM,
        filename: "drawing.DWG", // case-insensitive
      };

      const disposition = await handler({ claim: dwgClaim, attempts: 1 });

      expect(disposition).toBe("delete");
      expect(officeConvert.convert).not.toHaveBeenCalled();
      expect(ddb.markConverting).not.toHaveBeenCalled();
      expect(ddb.markFailed).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ error: "format_unsupported:dwg" }),
      );
    });

    it("respects excludeDwg=false — passes DWG through to office-convert", async () => {
      const { handler, officeConvert } = build(
        { kind: "caller_error", status: 400, failureClass: "unsupported_format", detail: "" },
        { excludeDwg: false },
      );
      const dwgClaim: ConvertClaim = { ...CLAIM, filename: "drawing.dwg" };

      await handler({ claim: dwgClaim, attempts: 1 });

      expect(officeConvert.convert).toHaveBeenCalled();
    });
  });

  describe("DDB row missing", () => {
    it("returns delete (don't redrive a phantom)", async () => {
      const officeConvert = fakeOfficeConvert({ kind: "success", status: 200, requestId: "x" });
      const ddb = fakeDdb();
      const conditionalFailure = Object.assign(new Error("row missing"), {
        name: "ConditionalCheckFailedException",
      });
      ddb.markConverting.mockRejectedValueOnce(conditionalFailure);
      const handler = createHandler({
        officeConvert,
        ddb,
        logger: silentLogger(),
        excludeDwg: true,
        outputBucket: (c) => c.sourceBucket,
        outputKey: (c) => `converted/${c.documentId}.pdf`,
    taskSignaler: noopTaskSignaler,
      });

      const disposition = await handler({ claim: CLAIM, attempts: 1 });
      expect(disposition).toBe("delete");
      expect(officeConvert.convert).not.toHaveBeenCalled();
    });

    it("redrives on any other DDB error", async () => {
      const officeConvert = fakeOfficeConvert({ kind: "success", status: 200, requestId: "x" });
      const ddb = fakeDdb();
      ddb.markConverting.mockRejectedValueOnce(
        Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" }),
      );
      const handler = createHandler({
        officeConvert,
        ddb,
        logger: silentLogger(),
        excludeDwg: true,
        outputBucket: (c) => c.sourceBucket,
        outputKey: (c) => `converted/${c.documentId}.pdf`,
    taskSignaler: noopTaskSignaler,
      });

      const disposition = await handler({ claim: CLAIM, attempts: 1 });
      expect(disposition).toBe("redrive");
      expect(officeConvert.convert).not.toHaveBeenCalled();
    });
  });
});
