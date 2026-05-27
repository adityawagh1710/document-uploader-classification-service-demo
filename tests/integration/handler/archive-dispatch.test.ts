// Integration test for the SqsArchiveDispatcher adapter against a real
// LocalStack SQS queue. Proves that a claim-check dispatched by the
// classifier lands in the zip-extraction queue with the exact schema
// the sibling service consumes (pipelineExecutionId / tenantId /
// documentId / sourceBucket / sourceKey / correlationId).
import { describe, it, expect, beforeAll } from "vitest";
import {
  SQSClient,
  CreateQueueCommand,
  ReceiveMessageCommand,
  PurgeQueueCommand,
} from "@aws-sdk/client-sqs";

import { getLocalstack } from "../_helpers.js";
import { silentLogger } from "../../../src/ports/Logger.js";
import { createSqsArchiveDispatcher } from "../../../src/adapters/sqs-archive-dispatcher/index.js";
import type { ArchiveClaimCheck } from "../../../src/ports/ArchiveDispatcher.js";

const QUEUE_NAME = "zip-extraction-queue-test";

interface QueueContext {
  sqs: SQSClient;
  queueUrl: string;
}

async function setupQueue(): Promise<QueueContext> {
  const { endpoint } = getLocalstack();
  const sqs = new SQSClient({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const created = await sqs.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
  const queueUrl = created.QueueUrl;
  if (queueUrl === undefined) {
    throw new Error("CreateQueue returned no QueueUrl");
  }
  return { sqs, queueUrl };
}

describe("SqsArchiveDispatcher (integration, LocalStack)", () => {
  let ctx: QueueContext;

  beforeAll(async () => {
    ctx = await setupQueue();
  });

  it("publishes the canonical claim-check payload zip-extraction expects", async () => {
    await ctx.sqs.send(new PurgeQueueCommand({ QueueUrl: ctx.queueUrl }));

    const dispatcher = createSqsArchiveDispatcher({
      sqs: ctx.sqs,
      queueUrl: ctx.queueUrl,
      logger: silentLogger,
    });

    const claim: ArchiveClaimCheck = {
      pipelineExecutionId: "exec-int-001",
      tenantId: "wks-int-001",
      documentId: "doc-int-001",
      sourceBucket: "test-source",
      sourceKey: "uploads/foo.zip",
      correlationId: "corr-int-001",
    };

    const result = await dispatcher.dispatch(claim);
    expect(result.ok).toBe(true);

    const received = await ctx.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: ctx.queueUrl,
        WaitTimeSeconds: 2,
        MaxNumberOfMessages: 1,
      }),
    );

    expect(received.Messages).toBeDefined();
    expect(received.Messages).toHaveLength(1);
    const body = JSON.parse(received.Messages![0]!.Body!) as unknown;
    expect(body).toEqual(claim);
  });

  it("returns queue-not-found when the queue url is invalid", async () => {
    const dispatcher = createSqsArchiveDispatcher({
      sqs: ctx.sqs,
      queueUrl: `${ctx.queueUrl}-does-not-exist`,
      logger: silentLogger,
    });

    const result = await dispatcher.dispatch({
      pipelineExecutionId: "x",
      tenantId: "x",
      documentId: "x",
      sourceBucket: "x",
      sourceKey: "x",
      correlationId: "x",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("queue-not-found");
    }
  });
});
