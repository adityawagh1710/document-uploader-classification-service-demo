import type { ZIPEntry } from "./types.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

const ODF_MIMETYPE_FORMAT_MAP: Readonly<Record<string, string>> = {
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.oasis.opendocument.graphics": "odg",
};

export function ooxmlFormatFromEntries(entries: ReadonlyArray<ZIPEntry>): string {
  // Default conservative: docx if we can't refine from later entries
  const filenames = entries.map((e) => e.filename);
  if (filenames.some((f) => f.startsWith("word/"))) return "docx";
  if (filenames.some((f) => f.startsWith("xl/"))) return "xlsx";
  if (filenames.some((f) => f.startsWith("ppt/"))) {
    // Without parsing the Content_Types.xml fully we conservatively return pptx;
    // macro-enabled / slideshow variants are refined by U-3's downstream where extension/MIME hints apply.
    return "pptx";
  }
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
