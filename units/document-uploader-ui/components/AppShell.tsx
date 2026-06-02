"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Opus2 application chrome: dark-navy sticky header with the brand logo and
 * primary navigation, plus a centered content container. Wraps every product
 * page (Workspaces / Document Transfer / Documents / Admin). The legacy
 * Monitor dashboard renders its own full-bleed dark shell and does not use
 * this component.
 */

interface NavItem {
  href: string;
  label: string;
}

const NAV: NavItem[] = [
  { href: "/", label: "Workspaces" },
  { href: "/documents", label: "Documents" },
  { href: "/admin", label: "Admin Config" },
  { href: "/monitor", label: "Monitor" },
];

export function AppShell({
  title,
  children,
  maxWidth = "max-w-7xl",
}: {
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" || pathname === "/workspaces" : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 bg-header text-header-foreground">
        <div className={cn("mx-auto flex items-center justify-between px-6 py-3", maxWidth)}>
          <div className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/opus2-logo.png" alt="Opus 2" className="h-6 w-auto" />
            {title ? (
              <>
                <div className="ml-4 h-6 w-px bg-header-foreground/20" />
                <h3 className="ml-4 text-base font-normal">{title}</h3>
              </>
            ) : null}
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-button px-3 py-1.5 text-xs font-bold transition-colors",
                  isActive(item.href)
                    ? "bg-header-foreground/15 text-header-foreground"
                    : "text-header-foreground/70 hover:bg-header-foreground/10 hover:text-header-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className={cn("mx-auto w-full flex-1 px-6 py-6", maxWidth)}>{children}</main>
    </div>
  );
}
