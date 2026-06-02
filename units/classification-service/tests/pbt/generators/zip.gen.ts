import fc from "fast-check";

// Build a minimal valid local file header at the given offset for a given filename.
function writeLocalFileHeader(
  buffer: Uint8Array,
  offset: number,
  filename: string,
  compressed: boolean,
  payload: Uint8Array = new Uint8Array(0),
): number {
  // PK\x03\x04 signature
  buffer[offset + 0] = 0x50;
  buffer[offset + 1] = 0x4b;
  buffer[offset + 2] = 0x03;
  buffer[offset + 3] = 0x04;
  // version-needed = 20
  buffer[offset + 4] = 20;
  buffer[offset + 5] = 0;
  // general purpose flags = 0
  buffer[offset + 6] = 0;
  buffer[offset + 7] = 0;
  // compression method
  const cm = compressed ? 8 : 0;
  buffer[offset + 8] = cm & 0xff;
  buffer[offset + 9] = (cm >> 8) & 0xff;
  // last mod time/date (zero)
  for (let i = 10; i < 14; i++) buffer[offset + i] = 0;
  // CRC32 (zero — we don't validate)
  for (let i = 14; i < 18; i++) buffer[offset + i] = 0;
  // compressed size
  const csize = payload.length;
  buffer[offset + 18] = csize & 0xff;
  buffer[offset + 19] = (csize >> 8) & 0xff;
  buffer[offset + 20] = (csize >> 16) & 0xff;
  buffer[offset + 21] = (csize >> 24) & 0xff;
  // uncompressed size
  buffer[offset + 22] = csize & 0xff;
  buffer[offset + 23] = (csize >> 8) & 0xff;
  buffer[offset + 24] = (csize >> 16) & 0xff;
  buffer[offset + 25] = (csize >> 24) & 0xff;
  // filename length
  const nameBytes = new TextEncoder().encode(filename);
  buffer[offset + 26] = nameBytes.length & 0xff;
  buffer[offset + 27] = (nameBytes.length >> 8) & 0xff;
  // extra length = 0
  buffer[offset + 28] = 0;
  buffer[offset + 29] = 0;

  for (let i = 0; i < nameBytes.length; i++) buffer[offset + 30 + i] = nameBytes[i]!;
  for (let i = 0; i < payload.length; i++) buffer[offset + 30 + nameBytes.length + i] = payload[i]!;

  return offset + 30 + nameBytes.length + payload.length;
}

export const ooxmlZipGen: fc.Arbitrary<Uint8Array> = fc.constantFrom("word/document.xml", "xl/workbook.xml", "ppt/presentation.xml").map((bodyEntry) => {
  const buf = new Uint8Array(1024);
  const off = writeLocalFileHeader(buf, 0, "[Content_Types].xml", true);
  writeLocalFileHeader(buf, off, bodyEntry, true);
  return buf;
});

export const odfZipGen: fc.Arbitrary<Uint8Array> = fc.constantFrom(
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.graphics",
).map((mime) => {
  const buf = new Uint8Array(1024);
  // mimetype entry is uncompressed (compression method = 0) with payload = the mime string
  const payload = new TextEncoder().encode(mime);
  writeLocalFileHeader(buf, 0, "mimetype", false, payload);
  return buf;
});

export const plainZipGen: fc.Arbitrary<Uint8Array> = fc.constant<Uint8Array>(
  (() => {
    const buf = new Uint8Array(512);
    writeLocalFileHeader(buf, 0, "readme.txt", false);
    return buf;
  })(),
);
