// BR-T-1: Binary-byte screen excludes ESC (0x1B); rejects on any other byte in
// [0x00..0x08] ∪ [0x0E..0x1F].
export function hasBinaryBytes(buffer: Uint8Array): boolean {
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if (b === undefined) continue;
    if (b === 0x1b) continue; // ESC excluded
    if ((b >= 0x00 && b <= 0x08) || (b >= 0x0e && b <= 0x1f)) return true;
  }
  return false;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const BOM = "﻿";

export function decodeText(buffer: Uint8Array): string {
  return utf8Decoder.decode(buffer);
}

// BR-T-2: XML — starts with <?xml (case-insensitive); optional BOM allowed.
export function isXML(text: string): boolean {
  const head = text.startsWith(BOM) ? text.slice(1, 11) : text.slice(0, 10);
  return /^<\?xml/i.test(head);
}

// BR-T-3: HTML — case-insensitive; attribute/whitespace tolerant.
const HTML_REGEX = /<(html|!doctype html|head)(\s|>)/i;
export function isHTML(text: string): boolean {
  const first1KB = text.slice(0, 1024);
  return HTML_REGEX.test(first1KB);
}

// BR-T-4: EML — count distinct RFC 5322 header names from the accepted set.
const ACCEPTED_EMAIL_HEADERS: ReadonlyArray<string> = [
  "from",
  "to",
  "cc",
  "bcc",
  "date",
  "subject",
  "received",
  "return-path",
  "reply-to",
  "message-id",
  "in-reply-to",
  "references",
  "mime-version",
];

export function countEmailHeaders(text: string): number {
  const first1KB = text.slice(0, 1024);
  const lines = first1KB.split(/\r?\n/);
  const found = new Set<string>();
  for (const line of lines) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):/.exec(line);
    if (!m || m[1] === undefined) continue;
    const name = m[1].toLowerCase();
    if (ACCEPTED_EMAIL_HEADERS.includes(name)) found.add(name);
    if (found.size >= 2) break;
  }
  return found.size;
}

// BR-T-5: DXF — both SECTION and HEADER keywords present (case-sensitive).
export function isDXF(text: string): boolean {
  const first1KB = text.slice(0, 1024);
  return /\bSECTION\b/.test(first1KB) && /\bHEADER\b/.test(first1KB);
}

// BR-T-6: CSV — ≥ 3 lines; same delimiter char across all lines; count per line within ±1 of median.
const CSV_DELIMITERS: ReadonlyArray<string> = [",", "\t", ";", "|"];

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1];
    const b = sorted[mid];
    if (a === undefined || b === undefined) return 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}

export function isCSV(buffer: Uint8Array): boolean {
  const text = decodeText(buffer);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 3) return false;

  for (const delim of CSV_DELIMITERS) {
    const counts = lines.map((line) => {
      let count = 0;
      for (const ch of line) if (ch === delim) count++;
      return count;
    });
    if (counts.some((c) => c === 0)) continue;
    const sorted = [...counts].sort((a, b) => a - b);
    const med = median(sorted);
    if (counts.every((c) => Math.abs(c - med) <= 1)) return true;
  }
  return false;
}

// BR-T-7: TXT — any printable content remains after binary screen.
export function hasAnyPrintableContent(buffer: Uint8Array): boolean {
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if (b === undefined) continue;
    if (b >= 0x20 && b <= 0x7e) return true;
    if (b >= 0x80) return true;
    if (b === 0x09 || b === 0x0a || b === 0x0d) return true;
  }
  return false;
}
