import { describe, it, expect, vi, beforeEach } from "vitest";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { createSqsConvertDispatcher } from "../../../../src/adapters/sqs-convert-dispatcher/index.js";
import { silentLogger } from "../../../../src/ports/Logger.js";
import type { ConvertClaimCheck } from "../../../../src/ports/ConvertDispatcher.js";

const QUEUE_URL = "https://sqs.eu-west-1.amazonaws.com/000000000000/classification-convert-queue-dev";

const CLAIM: ConvertClaimCheck = {
  pipelineExecutionId: "doc-1",
  tenantId: "wks-1",
  documentId: "doc-1",
  runId: "2026-05-28T12:00:00.000Z#doc-1",
  sourceBucket: "classification-ui-dev05",
  sourceKey: "ui/doc-1/invoice.docx",
  filename: "invoice.docx",
  subCategory: "office",
  correlationId: "corr-1",
};

describe("createSqsConvertDispatcher", () => {
  let sqs: SQSClient;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock = vi.fn().mockResolvedValue({});
    // Bypass the SDK's middleware stack — we just need to observe what command
    // got passed and what body it carried.
    sqs = { send: sendMock } as unknown as SQSClient;
  });

  it("posts a SendMessageCommand with the claim as JSON body", async () => {
    const d = createSqsConvertDispatcher({
      sqs,
      queueUrl: QUEUE_URL,
      logger: silentLogger,
    });

    const r = await d.dispatch(CLAIM);

    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = sendMock.mock.calls[0]?.[0] as SendMessageCommand;
    expect(cmd).toBeInstanceOf(SendMessageCommand);
    expect(cmd.input.QueueUrl).toBe(QUEUE_URL);
    const body = JSON.parse(cmd.input.MessageBody ?? "");
    expect(body).toEqual(CLAIM);
  });

  it("returns err(queue-not-found) when SQS reports NonExistentQueue", async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error("nope"), { name: "QueueDoesNotExist" }),
    );
    const d = createSqsConvertDispatcher({
      sqs,
      queueUrl: QUEUE_URL,
      logger: silentLogger,
    });

    const r = await d.dispatch(CLAIM);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("queue-not-found");
  });

  it("returns err(transient) on AbortError (timeout)", async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const d = createSqsConvertDispatcher({
      sqs,
      queueUrl: QUEUE_URL,
      logger: silentLogger,
    });

    const r = await d.dispatch(CLAIM);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("transient");
  });

  it("passes an AbortSignal to the SQS send call (so the timeout actually fires)", async () => {
    const d = createSqsConvertDispatcher({
      sqs,
      queueUrl: QUEUE_URL,
      logger: silentLogger,
    });

    await d.dispatch(CLAIM);

    const sendOpts = sendMock.mock.calls[0]?.[1] as { abortSignal?: AbortSignal };
    expect(sendOpts?.abortSignal).toBeInstanceOf(AbortSignal);
  });
});
