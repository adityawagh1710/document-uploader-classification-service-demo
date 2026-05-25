import type { CLSID } from "./types.js";
import { type Result, ok, err } from "./result.js";

export type ByteUtilError = "out-of-bounds";

export function readU16LE(buffer: Uint8Array, offset: number): Result<number, ByteUtilError> {
  if (offset < 0 || offset + 2 > buffer.length) return err("out-of-bounds");
  const b0 = buffer[offset];
  const b1 = buffer[offset + 1];
  if (b0 === undefined || b1 === undefined) return err("out-of-bounds");
  return ok(b0 | (b1 << 8));
}

export function readU32LE(buffer: Uint8Array, offset: number): Result<number, ByteUtilError> {
  if (offset < 0 || offset + 4 > buffer.length) return err("out-of-bounds");
  const b0 = buffer[offset];
  const b1 = buffer[offset + 1];
  const b2 = buffer[offset + 2];
  const b3 = buffer[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) return err("out-of-bounds");
  return ok((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0);
}

export function readI32LE(buffer: Uint8Array, offset: number): Result<number, ByteUtilError> {
  if (offset < 0 || offset + 4 > buffer.length) return err("out-of-bounds");
  const b0 = buffer[offset];
  const b1 = buffer[offset + 1];
  const b2 = buffer[offset + 2];
  const b3 = buffer[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) return err("out-of-bounds");
  return ok((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) | 0);
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function toHex(byte: number, width: number): string {
  return byte.toString(16).toUpperCase().padStart(width, "0");
}

// Decode 16 raw bytes into canonical CLSID string per the mixed-endian rule:
// bytes 0..3 LE DWORD -> group 1 (8 hex)
// bytes 4..5 LE WORD  -> group 2 (4 hex)
// bytes 6..7 LE WORD  -> group 3 (4 hex)
// bytes 8..9 big-endian -> group 4 (4 hex)
// bytes 10..15 big-endian -> group 5 (12 hex)
export function decodeCLSIDFromBytes(bytes: Uint8Array): Result<CLSID, ByteUtilError> {
  if (bytes.length < 16) return err("out-of-bounds");

  const b = (i: number): string => {
    const v = bytes[i];
    // Internal control flow only — the surrounding try/catch converts this
    // back to a Result.err before the function returns. No throw escapes.
    // eslint-disable-next-line no-restricted-syntax
    if (v === undefined) throw new RangeError("byte undefined");
    return toHex(v, 2);
  };

  try {
    const g1 = b(3) + b(2) + b(1) + b(0);
    const g2 = b(5) + b(4);
    const g3 = b(7) + b(6);
    const g4 = b(8) + b(9);
    const g5 = b(10) + b(11) + b(12) + b(13) + b(14) + b(15);
    return ok(`${g1}-${g2}-${g3}-${g4}-${g5}`);
  } catch {
    return err("out-of-bounds");
  }
}

// Encode canonical CLSID string to the 16-byte on-disk representation.
// Inverse of decodeCLSIDFromBytes — used by PBT-U1-001 round-trip property.
export function encodeCLSIDToBytes(clsid: CLSID): Result<Uint8Array, ByteUtilError> {
  // Expected: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX (uppercase canonical)
  const match = /^([0-9A-F]{8})-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{12})$/.exec(clsid);
  if (!match) return err("out-of-bounds");
  const [, g1, g2, g3, g4, g5] = match;
  if (!g1 || !g2 || !g3 || !g4 || !g5) return err("out-of-bounds");

  const bytes = new Uint8Array(16);
  // Group 1 little-endian: split g1 into pairs and reverse
  bytes[0] = parseInt(g1.slice(6, 8), 16);
  bytes[1] = parseInt(g1.slice(4, 6), 16);
  bytes[2] = parseInt(g1.slice(2, 4), 16);
  bytes[3] = parseInt(g1.slice(0, 2), 16);
  // Group 2 little-endian
  bytes[4] = parseInt(g2.slice(2, 4), 16);
  bytes[5] = parseInt(g2.slice(0, 2), 16);
  // Group 3 little-endian
  bytes[6] = parseInt(g3.slice(2, 4), 16);
  bytes[7] = parseInt(g3.slice(0, 2), 16);
  // Group 4 big-endian
  bytes[8] = parseInt(g4.slice(0, 2), 16);
  bytes[9] = parseInt(g4.slice(2, 4), 16);
  // Group 5 big-endian
  bytes[10] = parseInt(g5.slice(0, 2), 16);
  bytes[11] = parseInt(g5.slice(2, 4), 16);
  bytes[12] = parseInt(g5.slice(4, 6), 16);
  bytes[13] = parseInt(g5.slice(6, 8), 16);
  bytes[14] = parseInt(g5.slice(8, 10), 16);
  bytes[15] = parseInt(g5.slice(10, 12), 16);

  return ok(bytes);
}
