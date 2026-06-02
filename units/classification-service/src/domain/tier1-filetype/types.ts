export type Tier1Result =
  | { readonly matched: true; readonly ext: string; readonly mime: string }
  | { readonly matched: false };

export interface Tier1FileTypeDetector {
  detect(buffer: Uint8Array): Promise<Tier1Result>;
}
