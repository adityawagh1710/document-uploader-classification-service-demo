import {
  EXTENSION_CORROBORATE_MODIFIER,
  EXTENSION_CONTRADICT_MODIFIER,
} from "../../shared/constants.js";
import { FORMAT_METADATA, ALL_KNOWN_EXTENSIONS } from "./format-metadata.js";
import type { ScoringInput } from "./types.js";

export function extensionModifier(input: ScoringInput): number {
  if (!input.extension || !input.detectedFormat) return 0;

  const ext = input.extension.toLowerCase().replace(/^\./, "");
  const meta = FORMAT_METADATA[input.detectedFormat.toLowerCase()];

  if (meta && meta.extensions.includes(ext)) return EXTENSION_CORROBORATE_MODIFIER;

  if (ALL_KNOWN_EXTENSIONS.has(ext)) return EXTENSION_CONTRADICT_MODIFIER;

  return 0;
}
