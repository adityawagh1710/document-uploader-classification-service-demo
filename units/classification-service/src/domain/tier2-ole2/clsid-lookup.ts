import type { CLSID } from "../../shared/types.js";

export const CLSID_LOOKUP_TABLE: Readonly<Record<CLSID, string>> = {
  "00020906-0000-0000-C000-000000000046": "doc",
  "00020820-0000-0000-C000-000000000046": "xls",
  "64818D10-4F9B-11CF-86EA-00AA00B929E8": "ppt",
  "00020D0B-0000-0000-C000-000000000046": "msg",
  "00020900-0000-0000-C000-000000000046": "vsd",
};

export function lookupFormatForCLSID(clsid: CLSID): string | undefined {
  return CLSID_LOOKUP_TABLE[clsid];
}
