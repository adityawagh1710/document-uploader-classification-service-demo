import type { Metadata } from "next";
import "./globals.css";

// Opus2 brand typeface (Lato) is loaded via a CSS @import in globals.css and
// exposed as the --font-lato variable consumed by tailwind.config.ts
// (fontFamily.sans). Using @import rather than next/font keeps the build
// network-independent (LocalStack/offline dev) — fonts resolve at runtime.

export const metadata: Metadata = {
  title: "Opus 2 · Document Transfer",
  description: "Document ingestion & classification — Opus 2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
