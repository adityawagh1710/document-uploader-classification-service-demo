import fc from "fast-check";
import { encodeCLSIDToBytes } from "../../../src/shared/byte-utils.js";
import { OLE2_SIGNATURE } from "../../../src/shared/constants.js";
import type { CLSID } from "../../../src/shared/types.js";

// Synthesize a 4,100-byte OLE2 buffer with a given CLSID embedded at directoryOffset+80.
// directoryOffset is computed from sectorId; we use sectorId=0 by default so directoryOffset=512.
export function buildOLE2Buffer(opts: {
  clsid: CLSID;
  sectorId?: number;
  sectorSize?: number;
  bufferLength?: number;
}): Uint8Array {
  const sectorId = opts.sectorId ?? 0;
  const sectorSize = opts.sectorSize ?? 0x0009;
  const length = opts.bufferLength ?? 4100;
  const buf = new Uint8Array(length);

  // Signature at offset 0
  for (let i = 0; i < OLE2_SIGNATURE.length; i++) {
    buf[i] = OLE2_SIGNATURE[i]!;
  }

  // Sector size (u16 LE) at offset 30
  buf[30] = sectorSize & 0xff;
  buf[31] = (sectorSize >> 8) & 0xff;

  // Directory sector ID (i32 LE) at offset 48
  buf[48] = sectorId & 0xff;
  buf[49] = (sectorId >> 8) & 0xff;
  buf[50] = (sectorId >> 16) & 0xff;
  buf[51] = (sectorId >> 24) & 0xff;

  const directoryOffset = 512 * (1 + sectorId);
  if (directoryOffset + 128 <= length) {
    const clsidBytes = encodeCLSIDToBytes(opts.clsid);
    if (clsidBytes.ok) {
      for (let i = 0; i < 16; i++) {
        buf[directoryOffset + 80 + i] = clsidBytes.value[i]!;
      }
    }
  }

  return buf;
}

export const ole2BufferWithCLSIDGen = (clsidGen: fc.Arbitrary<CLSID>): fc.Arbitrary<{ buffer: Uint8Array; clsid: CLSID }> =>
  clsidGen.map((clsid) => ({ buffer: buildOLE2Buffer({ clsid }), clsid }));

// Non-standard sector size buffer (sectorSize !== 0x0009)
export const nonStandardSectorSizeOLE2Gen: fc.Arbitrary<Uint8Array> = fc
  .tuple(fc.constant("00020906-0000-0000-C000-000000000046" as CLSID), fc.integer({ min: 1, max: 0xffff }).filter((s) => s !== 0x0009))
  .map(([clsid, sectorSize]) => buildOLE2Buffer({ clsid, sectorSize }));

// Buffer where directory_offset + 128 > 4100, i.e., sectorId large enough to push beyond window
export const directoryBeyondWindowOLE2Gen: fc.Arbitrary<Uint8Array> = fc
  .tuple(fc.constant("00020906-0000-0000-C000-000000000046" as CLSID), fc.integer({ min: 8, max: 100 }))
  .map(([clsid, sectorId]) => buildOLE2Buffer({ clsid, sectorId }));
