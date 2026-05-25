import { ZIP_LOCAL_FILE_HEADER_SIGNATURE } from "../../shared/constants.js";
import { readU16LE, readU32LE } from "../../shared/byte-utils.js";
import type { ZIPMarkerParser, ZIPEntry } from "./types.js";

function hasLocalFileHeader(buffer: Uint8Array, offset: number): boolean {
  if (offset + 4 > buffer.length) return false;
  for (let i = 0; i < ZIP_LOCAL_FILE_HEADER_SIGNATURE.length; i++) {
    if (buffer[offset + i] !== ZIP_LOCAL_FILE_HEADER_SIGNATURE[i]) return false;
  }
  return true;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

export function createZIPMarkerParser(): ZIPMarkerParser {
  return Object.freeze({
    scanEntries(buffer: Uint8Array, maxEntries: number): ZIPEntry[] {
      const entries: ZIPEntry[] = [];
      let offset = 0;

      while (entries.length < maxEntries && offset + 30 <= buffer.length) {
        if (!hasLocalFileHeader(buffer, offset)) break;

        const compressionRead = readU16LE(buffer, offset + 8);
        const filenameLengthRead = readU16LE(buffer, offset + 26);
        const extraLengthRead = readU16LE(buffer, offset + 28);
        const compressedSizeRead = readU32LE(buffer, offset + 18);
        if (!compressionRead.ok || !filenameLengthRead.ok || !extraLengthRead.ok || !compressedSizeRead.ok) break;

        const filenameStart = offset + 30;
        const filenameEnd = filenameStart + filenameLengthRead.value;
        if (filenameEnd > buffer.length) break;

        const filename = utf8Decoder.decode(buffer.subarray(filenameStart, filenameEnd));

        entries.push({
          filename,
          uncompressed: compressionRead.value === 0,
          position: offset,
        });

        offset = filenameEnd + extraLengthRead.value + compressedSizeRead.value;
        if (offset <= filenameEnd) break; // guard against overflow / corrupted size
      }

      return entries;
    },
  });
}
