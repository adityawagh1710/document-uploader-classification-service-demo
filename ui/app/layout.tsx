import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Classification Service · Test UI",
  description: "Local + dev EKS test dashboard for the Classification Service",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
