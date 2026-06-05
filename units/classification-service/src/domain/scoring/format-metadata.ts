// Format -> expected extensions + MIME types (BR-S-4)
export interface FormatMetadata {
  readonly extensions: ReadonlyArray<string>;
  readonly mimeTypes: ReadonlyArray<string>;
}

export const FORMAT_METADATA: Readonly<Record<string, FormatMetadata>> = {
  pdf: { extensions: ["pdf"], mimeTypes: ["application/pdf"] },
  docx: {
    extensions: ["docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  xlsx: {
    extensions: ["xlsx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  pptx: {
    extensions: ["pptx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  },
  docm: { extensions: ["docm"], mimeTypes: ["application/vnd.ms-word.document.macroEnabled.12"] },
  xlsm: { extensions: ["xlsm"], mimeTypes: ["application/vnd.ms-excel.sheet.macroEnabled.12"] },
  pptm: { extensions: ["pptm"], mimeTypes: ["application/vnd.ms-powerpoint.presentation.macroEnabled.12"] },
  ppsx: {
    extensions: ["ppsx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.slideshow"],
  },
  doc: { extensions: ["doc"], mimeTypes: ["application/msword"] },
  xls: { extensions: ["xls", "xlt"], mimeTypes: ["application/vnd.ms-excel"] },
  ppt: { extensions: ["ppt", "pot"], mimeTypes: ["application/vnd.ms-powerpoint"] },
  pps: { extensions: ["pps"], mimeTypes: ["application/vnd.ms-powerpoint"] },
  msg: { extensions: ["msg"], mimeTypes: ["application/vnd.ms-outlook"] },
  vsd: { extensions: ["vsd", "vst"], mimeTypes: ["application/vnd.visio"] },
  mpp: { extensions: ["mpp"], mimeTypes: ["application/vnd.ms-project"] },
  odt: { extensions: ["odt"], mimeTypes: ["application/vnd.oasis.opendocument.text"] },
  ods: { extensions: ["ods"], mimeTypes: ["application/vnd.oasis.opendocument.spreadsheet"] },
  odp: { extensions: ["odp"], mimeTypes: ["application/vnd.oasis.opendocument.presentation"] },
  odg: { extensions: ["odg"], mimeTypes: ["application/vnd.oasis.opendocument.graphics"] },
  rtf: { extensions: ["rtf"], mimeTypes: ["application/rtf", "text/rtf"] },
  dwg: { extensions: ["dwg"], mimeTypes: ["application/acad", "image/vnd.dwg"] },
  tiff: { extensions: ["tif", "tiff"], mimeTypes: ["image/tiff"] },
  png: { extensions: ["png"], mimeTypes: ["image/png"] },
  jpg: { extensions: ["jpg", "jpeg"], mimeTypes: ["image/jpeg"] },
  bmp: { extensions: ["bmp"], mimeTypes: ["image/bmp"] },
  gif: { extensions: ["gif"], mimeTypes: ["image/gif"] },
  mp3: { extensions: ["mp3"], mimeTypes: ["audio/mpeg"] },
  wav: { extensions: ["wav"], mimeTypes: ["audio/wav"] },
  ogg: { extensions: ["ogg"], mimeTypes: ["audio/ogg", "video/ogg"] },
  mp4: { extensions: ["mp4", "mov"], mimeTypes: ["video/mp4", "video/quicktime"] },
  zip: { extensions: ["zip"], mimeTypes: ["application/zip"] },
  xml: { extensions: ["xml"], mimeTypes: ["application/xml", "text/xml"] },
  html: { extensions: ["html", "htm"], mimeTypes: ["text/html"] },
  eml: { extensions: ["eml"], mimeTypes: ["message/rfc822"] },
  dxf: { extensions: ["dxf"], mimeTypes: ["image/vnd.dxf", "application/dxf"] },
  csv: { extensions: ["csv"], mimeTypes: ["text/csv"] },
  txt: { extensions: ["txt"], mimeTypes: ["text/plain"] },
};

export const ALL_KNOWN_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.values(FORMAT_METADATA).flatMap((m) => m.extensions),
);

export const ALL_KNOWN_MIME_TYPES: ReadonlySet<string> = new Set(
  Object.values(FORMAT_METADATA).flatMap((m) => m.mimeTypes),
);
