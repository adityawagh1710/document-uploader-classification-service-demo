export type Tier3TextFormat = "xml" | "html" | "eml" | "dxf" | "csv" | "txt";

export type Tier3Result =
  | { readonly matched: true; readonly format: Tier3TextFormat; readonly matchType: "text-heuristic" }
  | { readonly matched: false; readonly reason: "binary-bytes" | "no-pattern-matched" };

export interface Tier3TextDetector {
  detect(buffer: Uint8Array): Tier3Result;
}
