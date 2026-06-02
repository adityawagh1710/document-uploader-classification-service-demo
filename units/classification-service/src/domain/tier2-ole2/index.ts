export type { OLE2Parser, OLE2ParseError, Tier2OLE2Detector, Tier2OLE2Result } from "./types.js";
export { createOLE2Parser } from "./OLE2Parser.js";
export { createTier2OLE2Detector } from "./Tier2OLE2Detector.js";
export { CLSID_LOOKUP_TABLE, lookupFormatForCLSID } from "./clsid-lookup.js";
export { ole2ExtensionToFormat } from "./extension-fallback.js";
