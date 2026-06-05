import type { CLSID } from "../../shared/types.js";
import { type Result, ok, err } from "../../shared/result.js";
import { readU16LE, readI32LE, decodeCLSIDFromBytes } from "../../shared/byte-utils.js";
import {
  DETECTION_WINDOW_BYTES,
  ROOT_ENTRY_SIZE,
  CLSID_OFFSET_IN_ROOT_ENTRY,
  STANDARD_SECTOR_BYTES,
  STANDARD_SECTOR_SIZE_LOG,
  OLE2_SIGNATURE,
} from "../../shared/constants.js";
import type { OLE2Parser, OLE2ParseError } from "./types.js";

// Mixed-endian CLSID extraction per Microsoft Compound File Binary Format.
// See aidlc-docs/construction/classifier-core/functional-design/business-logic-model.md §2.
//
// Worked example (Word .doc CLSID 00020906-0000-0000-C000-000000000046):
//   on-disk bytes: 06 09 02 00 00 00 00 00 C0 00 00 00 00 00 00 46
//   bytes 0..3 LE -> group 1 "00020906"
//   bytes 4..5 LE -> group 2 "0000"
//   bytes 6..7 LE -> group 3 "0000"
//   bytes 8..9 BE -> group 4 "C000"
//   bytes 10..15 BE -> group 5 "000000000046"

function hasOLE2Signature(buffer: Uint8Array): boolean {
  if (buffer.length < OLE2_SIGNATURE.length) return false;
  for (let i = 0; i < OLE2_SIGNATURE.length; i++) {
    if (buffer[i] !== OLE2_SIGNATURE[i]) return false;
  }
  return true;
}

export function createOLE2Parser(): OLE2Parser {
  return Object.freeze({
    parseCLSID(buffer: Uint8Array): Result<CLSID, OLE2ParseError> {
      // GATE 1: signature
      if (!hasOLE2Signature(buffer)) return err("missing-ole2-signature");

      // GATE 2: sector size at offset 30 (u16 LE) must be 0x0009
      const sectorSizeRead = readU16LE(buffer, 30);
      if (!sectorSizeRead.ok) return err("non-standard-sector-size");
      if (sectorSizeRead.value !== STANDARD_SECTOR_SIZE_LOG) return err("non-standard-sector-size");

      // GATE 3: directory sector ID at offset 48 (i32 LE)
      const sectorIdRead = readI32LE(buffer, 48);
      if (!sectorIdRead.ok) return err("directory-beyond-window");
      const sectorId = sectorIdRead.value;
      if (sectorId < 0) return err("directory-beyond-window");

      const directoryOffset = STANDARD_SECTOR_BYTES * (1 + sectorId);

      // GATE 4: bounds — Root Entry must fit fully within the detection window AND the buffer
      if (directoryOffset + ROOT_ENTRY_SIZE > DETECTION_WINDOW_BYTES) return err("directory-beyond-window");
      if (directoryOffset + ROOT_ENTRY_SIZE > buffer.length) return err("directory-beyond-window");

      // Read 16 CLSID bytes and decode
      const clsidStart = directoryOffset + CLSID_OFFSET_IN_ROOT_ENTRY;
      const clsidBytes = buffer.subarray(clsidStart, clsidStart + 16);
      const decoded = decodeCLSIDFromBytes(clsidBytes);
      if (!decoded.ok) return err("directory-beyond-window");

      return ok(decoded.value);
    },
  });
}
