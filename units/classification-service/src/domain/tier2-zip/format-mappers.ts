import type { ZIPEntry } from "./types.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

const ODF_MIMETYPE_FORMAT_MAP: Readonly<Record<string, string>> = {
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.oasis.opendocument.graphics": "odg",
};

export const OOXML_EXTENSIONS = new Set([
  "docx", "docm",
  "xlsx", "xlsm",
  "pptx", "pptm", "ppsx",
]);

export function ooxmlFormatFromEntries(
  entries: ReadonlyArray<ZIPEntry>,
  extensionHint?: string | null,
): string {
  // Prefer disambiguation from scanned entries — the part-name prefixes
  // (word/, xl/, ppt/) are definitive evidence of the OOXML variant.
  const filenames = entries.map((e) => e.filename);
  if (filenames.some((f) => f.startsWith("word/"))) return "docx";
  if (filenames.some((f) => f.startsWith("xl/"))) return "xlsx";
  if (filenames.some((f) => f.startsWith("ppt/"))) {
    // Macro-enabled / slideshow variants need extension/MIME hints to refine
    // (we can't tell .pptx from .pptm from .ppsx without parsing Content_Types).
    return "pptx";
  }

  // No disambiguating part-name surfaced in the scan window (common when
  // OOXML files lead with `[Content_Types].xml`, `_rels/.rels`, `docProps/*`
  // before the format-specific `word|xl|ppt/` parts). Fall back to the user
  // extension hint if it's a known OOXML extension — beats silently guessing.
  if (extensionHint) {
    const ext = extensionHint.toLowerCase().replace(/^\./, "");
    if (OOXML_EXTENSIONS.has(ext)) return ext;
  }

  // Last-resort default — preserves prior behaviour for callers with no hint.
  return "docx";
}

export function odfFormatFromMimetype(buffer: Uint8Array, entry: ZIPEntry): string | null {
  // The uncompressed `mimetype` entry stores its content immediately after the
  // local file header (signature + 26 fixed bytes + filename + extra). We don't
  // know exact extra length so we approximate by searching forward up to 256 bytes.
  const start = entry.position + 30 + entry.filename.length;
  const end = Math.min(start + 256, buffer.length);
  if (start >= buffer.length) return null;

  const text = utf8Decoder.decode(buffer.subarray(start, end));
  for (const [mime, format] of Object.entries(ODF_MIMETYPE_FORMAT_MAP)) {
    if (text.includes(mime)) return format;
  }
  return null;
}
