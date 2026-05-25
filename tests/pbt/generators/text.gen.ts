import fc from "fast-check";

export const xmlTextGen: fc.Arbitrary<Uint8Array> = fc
  .stringMatching(/^<\?xml version="1\.0"\?>\n<root\/>$/)
  .map((s) => new TextEncoder().encode(s));

export const htmlTextGen: fc.Arbitrary<Uint8Array> = fc
  .constantFrom("<html>", "<HTML>", "<html lang=\"en\">", "<!DOCTYPE html>", "<!DOCTYPE HTML>", "<head>")
  .map((s) => new TextEncoder().encode(s + "<body>hello</body>"));

const ACCEPTED_HEADERS = [
  "From", "To", "Cc", "Date", "Subject", "Received",
  "Return-Path", "Reply-To", "Message-ID", "MIME-Version",
];

export const emlTextGen: fc.Arbitrary<Uint8Array> = fc
  .subarray(ACCEPTED_HEADERS, { minLength: 2, maxLength: 5 })
  .map((headers) => {
    const lines = headers.map((h) => `${h}: value`).join("\n");
    return new TextEncoder().encode(lines + "\n\nBody here.");
  });

export const csvTextGen: fc.Arbitrary<Uint8Array> = fc
  .integer({ min: 3, max: 10 })
  .chain((numLines) =>
    fc.integer({ min: 1, max: 5 }).map((numCommas) => {
      const lines: string[] = [];
      for (let i = 0; i < numLines; i++) {
        const cells = Array.from({ length: numCommas + 1 }, (_, j) => `r${i}c${j}`);
        lines.push(cells.join(","));
      }
      return new TextEncoder().encode(lines.join("\n"));
    }),
  );

// Buffer with at least one binary byte at a random position (excluding ESC)
export const binaryByteBufferGen: fc.Arbitrary<Uint8Array> = fc
  .integer({ min: 0, max: 0x1f })
  .filter((b) => b !== 0x1b && !(b >= 0x09 && b <= 0x0d))
  .chain((byte) =>
    fc.integer({ min: 0, max: 50 }).map((pos) => {
      const buf = new Uint8Array(100).fill(0x20); // padding spaces
      buf[pos] = byte;
      return buf;
    }),
  );
