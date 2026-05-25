import { z } from "zod";
import { type Result, ok, err } from "../shared/result.js";
import type { TaskPayload } from "../shared/types.js";
import type { ClassificationFailure, InputValidator } from "./types.js";

// Strict on required + passthrough on unknowns (Q1=A).
const TaskPayloadSchema = z.object({
  taskToken: z.string().min(1),
  workspaceId: z.string().min(1),
  documentId: z.string().min(1),
  s3: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  hints: z.object({
    extension: z.string().nullable(),
    contentType: z.string().nullable(),
  }),
  context: z.object({
    parentArchiveDepth: z.number().int().min(0),
    overrideDuplicateCheck: z.boolean(),
  }),
}).passthrough();

export function createInputValidator(): InputValidator {
  return Object.freeze({
    validate(unknownPayload: unknown):
      Result<TaskPayload, Extract<ClassificationFailure, { kind: "input-validation" }>> {
      const parsed = TaskPayloadSchema.safeParse(unknownPayload);
      if (parsed.success) {
        return ok(parsed.data as unknown as TaskPayload);
      }
      const issue = parsed.error.issues[0];
      if (issue === undefined) {
        return err({ kind: "input-validation", field: "(unknown)", message: "validation failed" });
      }
      return err({
        kind: "input-validation",
        field: issue.path.join("."),
        message: issue.message,
      });
    },
  });
}
