import {
  type SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message,
} from "@aws-sdk/client-sqs";
import { parseConvertClaim } from "./message.js";
import type { MessageDisposition } from "./handler.js";
import type { Logger } from "./logger.js";

export interface PollerDeps {
  readonly sqs: SQSClient;
  readonly queueUrl: string;
  readonly waitTimeSeconds: number;
  readonly maxMessages: number;
  readonly handle: (args: {
    claim: import("./message.js").ConvertClaim;
    attempts: number;
  }) => Promise<MessageDisposition>;
  readonly logger: Logger;
  /**
   * Cancellation signal — the main loop wires this to SIGTERM/SIGINT so a
   * pod kill stops cleanly without losing an in-flight message
   * (visibility-timeout takes care of it from SQS's side).
   */
  readonly signal: AbortSignal;
}

/**
 * Long-polling SQS consumer. One worker process = one poller loop. No
 * concurrency-per-process — each message can drive a 30-min office-convert
 * call, so we keep the process serial and scale horizontally via replicas
 * (the Helm chart + KEDA in feat/04, feat/07).
 */
export async function runPoller(deps: PollerDeps): Promise<void> {
  const { sqs, queueUrl, waitTimeSeconds, maxMessages, handle, logger, signal } = deps;
  logger.info("poller.start", { queueUrl, waitTimeSeconds, maxMessages });

  while (!signal.aborted) {
    let messages: Message[];
    try {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitTimeSeconds,
          // Hand back the receive-count so the handler can stamp it onto the
          // DDB row (powers the UI's "attempt N of 3" badge).
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }),
        { abortSignal: signal },
      );
      messages = res.Messages ?? [];
    } catch (e) {
      if (signal.aborted) break;
      logger.error("poller.receive_failed", {
        errorName: (e as Error)?.name,
        message: (e as Error)?.message,
      });
      // Back off briefly so a queue-down loop doesn't pin CPU.
      await sleep(2_000, signal);
      continue;
    }

    if (messages.length === 0) {
      logger.debug("poller.empty_receive");
      continue;
    }

    for (const msg of messages) {
      if (signal.aborted) break;
      await processOne(msg);
    }
  }

  logger.info("poller.stop");

  async function processOne(msg: Message): Promise<void> {
    if (!msg.Body || !msg.ReceiptHandle) {
      logger.warn("poller.malformed_message", { messageId: msg.MessageId });
      return;
    }
    const attempts = Number(msg.Attributes?.ApproximateReceiveCount ?? "1");
    const parsed = parseConvertClaim(msg.Body);
    if (!parsed.ok) {
      // Unparseable bodies are terminal — there's no recovery. Drop the
      // message rather than letting SQS redrive a poison-pill into the DLQ
      // (the DLQ alarm would fire on every push of a broken producer).
      logger.error("poller.parse_failed", {
        messageId: msg.MessageId,
        error: parsed.error,
        bodyPreview: msg.Body.slice(0, 200),
      });
      await deleteSafely(msg.ReceiptHandle, msg.MessageId);
      return;
    }

    let disposition: MessageDisposition;
    try {
      disposition = await handle({ claim: parsed.claim, attempts });
    } catch (e) {
      // Handler shouldn't throw — every known failure mode returns a
      // disposition. If it does throw, treat as transient and let SQS redrive.
      logger.error("poller.handler_uncaught", {
        messageId: msg.MessageId,
        errorName: (e as Error)?.name,
        message: (e as Error)?.message,
      });
      disposition = "redrive";
    }

    if (disposition === "delete") {
      await deleteSafely(msg.ReceiptHandle, msg.MessageId);
    } else {
      // redrive — leave the message; SQS's visibility timeout will redeliver.
      logger.debug("poller.redrive", { messageId: msg.MessageId, attempts });
    }
  }

  async function deleteSafely(
    receiptHandle: string,
    messageId: string | undefined,
  ): Promise<void> {
    try {
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
      );
    } catch (e) {
      // Delete failure isn't catastrophic — message will redrive. Log loudly.
      logger.error("poller.delete_failed", {
        messageId,
        errorName: (e as Error)?.name,
        message: (e as Error)?.message,
      });
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
