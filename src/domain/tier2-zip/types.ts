export interface ZIPEntry {
  readonly filename: string;
  readonly uncompressed: boolean;
  readonly position: number;
}

export interface ZIPMarkerParser {
  scanEntries(buffer: Uint8Array, maxEntries: number): ZIPEntry[];
}

export type Tier2ZIPResult =
  | { readonly matched: true; readonly format: string; readonly family: "ooxml" | "odf"; readonly matchType: "zip-with-ooxml-or-odf" }
  | { readonly matched: true; readonly format: "zip"; readonly family: "plain"; readonly matchType: "exact-unique-signature" }
  | { readonly matched: false };

export interface Tier2ZIPDetector {
  detect(buffer: Uint8Array): Tier2ZIPResult;
}
