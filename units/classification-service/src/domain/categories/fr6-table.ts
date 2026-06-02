import type { CategoryDecision } from "./types.js";

// FR-6 main mapping table (BR-C-1) — format -> { category, subCategory }
export const FR6_TABLE: Readonly<Record<string, CategoryDecision>> = {
  // ocr-direct
  pdf: { category: "ocr-direct", subCategory: null },
  jpg: { category: "ocr-direct", subCategory: null },
  png: { category: "ocr-direct", subCategory: null },
  bmp: { category: "ocr-direct", subCategory: null },

  // media
  gif: { category: "media", subCategory: null },
  mp3: { category: "media", subCategory: null },
  wav: { category: "media", subCategory: null },
  ogg: { category: "media", subCategory: null },
  mp4: { category: "media", subCategory: null },

  // convert with various sub-categories
  rtf: { category: "convert", subCategory: "office" },
  dwg: { category: "convert", subCategory: null },
  // tiff handled by precedence rule in CategoryMapper.map (always "tiff")

  // OLE2 office (CLSID path) — sub-category overridden by CategoryMapper to "convert-then-ocr"
  // when detectionTier === "ole2-clsid"
  doc: { category: "convert", subCategory: "office" },
  xls: { category: "convert", subCategory: "office" },
  ppt: { category: "convert", subCategory: "office" },
  pps: { category: "convert", subCategory: "office" },
  vsd: { category: "convert", subCategory: "office" },
  mpp: { category: "convert", subCategory: "office" },

  // OOXML / ODF office
  docx: { category: "convert", subCategory: "office" },
  docm: { category: "convert", subCategory: "office" },
  xlsx: { category: "convert", subCategory: "office" },
  xlsm: { category: "convert", subCategory: "office" },
  pptx: { category: "convert", subCategory: "office" },
  pptm: { category: "convert", subCategory: "office" },
  ppsx: { category: "convert", subCategory: "office" },
  odt: { category: "convert", subCategory: "office" },
  ods: { category: "convert", subCategory: "office" },
  odp: { category: "convert", subCategory: "office" },
  odg: { category: "convert", subCategory: "office" },

  // ZIP plain
  zip: { category: "archive", subCategory: null },

  // text formats
  xml: { category: "convert", subCategory: null },
  csv: { category: "convert", subCategory: null },
  dxf: { category: "convert", subCategory: null },
  html: { category: "convert", subCategory: "html" },
  txt: { category: "convert", subCategory: null },

  // email
  msg: { category: "email", subCategory: null },
  eml: { category: "email", subCategory: null },
};

export const CONVERT_THEN_OCR_FORMATS: ReadonlySet<string> = new Set(["doc", "xls", "ppt", "pps", "vsd"]);
