import {
  CONTENT_TYPE_CORROBORATE_MODIFIER,
  CONTENT_TYPE_CONTRADICT_MODIFIER,
} from "../../shared/constants.js";
import { FORMAT_METADATA, ALL_KNOWN_MIME_TYPES } from "./format-metadata.js";
import type { ScoringInput } from "./types.js";

export function contentTypeModifier(input: ScoringInput): number {
  if (!input.contentType || !input.detectedFormat) return 0;

  const ct = input.contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!ct) return 0;

  const meta = FORMAT_METADATA[input.detectedFormat.toLowerCase()];
  if (meta && meta.mimeTypes.includes(ct)) return CONTENT_TYPE_CORROBORATE_MODIFIER;

  if (ALL_KNOWN_MIME_TYPES.has(ct)) return CONTENT_TYPE_CONTRADICT_MODIFIER;

  return 0;
}
