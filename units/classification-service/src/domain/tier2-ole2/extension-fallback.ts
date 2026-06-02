const OLE2_EXTENSION_MAP: Readonly<Record<string, string>> = {
  doc: "doc",
  xls: "xls",
  xlt: "xls",
  ppt: "ppt",
  pot: "ppt",
  pps: "pps",
  msg: "msg",
  vsd: "vsd",
  vst: "vsd",
  mpp: "mpp",
};

export function ole2ExtensionToFormat(extension: string | null): string | null {
  if (!extension) return null;
  const normalised = extension.toLowerCase().replace(/^\./, "");
  return OLE2_EXTENSION_MAP[normalised] ?? null;
}
