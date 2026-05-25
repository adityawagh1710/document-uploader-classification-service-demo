import type { CLSID } from "../../shared/types.js";
import type { Result } from "../../shared/result.js";

export type OLE2ParseError =
  | "missing-ole2-signature"
  | "non-standard-sector-size"
  | "directory-beyond-window";

export interface OLE2Parser {
  parseCLSID(buffer: Uint8Array): Result<CLSID, OLE2ParseError>;
}

export type Tier2OLE2Result =
  | { readonly matched: true; readonly format: string; readonly clsid: CLSID; readonly matchType: "ole2-with-clsid" }
  | { readonly matched: true; readonly format: string; readonly matchType: "ole2-or-zip-ext-fallback" }
  | { readonly matched: false };

export interface Tier2OLE2Detector {
  detect(buffer: Uint8Array, extension: string | null): Tier2OLE2Result;
}
