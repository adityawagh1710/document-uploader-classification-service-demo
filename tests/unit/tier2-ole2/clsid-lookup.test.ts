import { describe, it, expect } from "vitest";
import { CLSID_LOOKUP_TABLE, lookupFormatForCLSID } from "../../../src/domain/tier2-ole2/index.js";

describe("CLSID lookup table", () => {
  it("contains the 5 spec-required mappings", () => {
    expect(CLSID_LOOKUP_TABLE).toEqual({
      "00020906-0000-0000-C000-000000000046": "doc",
      "00020820-0000-0000-C000-000000000046": "xls",
      "64818D10-4F9B-11CF-86EA-00AA00B929E8": "ppt",
      "00020D0B-0000-0000-C000-000000000046": "msg",
      "00020900-0000-0000-C000-000000000046": "vsd",
    });
  });

  it("returns undefined for unknown CLSIDs", () => {
    expect(lookupFormatForCLSID("DEADBEEF-0000-0000-0000-000000000000")).toBeUndefined();
  });
});
