import type { MatchType } from "./types.js";

export const DETECTION_WINDOW_BYTES = 4100;
export const ROOT_ENTRY_SIZE = 128;
export const CLSID_OFFSET_IN_ROOT_ENTRY = 80;
export const STANDARD_SECTOR_SIZE_LOG = 0x0009;
export const STANDARD_SECTOR_BYTES = 512;

export const OLE2_SIGNATURE: ReadonlyArray<number> = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
export const ZIP_LOCAL_FILE_HEADER_SIGNATURE: ReadonlyArray<number> = [0x50, 0x4b, 0x03, 0x04];

export const BASE_SCORE_TABLE: Readonly<Record<MatchType, number>> = {
  "exact-unique-signature": 0.95,
  "ole2-with-clsid": 0.9,
  "zip-with-ooxml-or-odf": 0.9,
  "ole2-or-zip-ext-fallback": 0.7,
  "text-heuristic": 0.65,
  "extension-only": 0.4,
  "no-match": 0,
};

export const EXTENSION_CORROBORATE_MODIFIER = 0.05;
export const EXTENSION_CONTRADICT_MODIFIER = -0.15;
export const CONTENT_TYPE_CORROBORATE_MODIFIER = 0.05;
export const CONTENT_TYPE_CONTRADICT_MODIFIER = -0.1;
