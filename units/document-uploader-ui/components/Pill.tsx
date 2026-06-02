import { cn } from "@/lib/cn";

type Tone = "ok" | "warn" | "crit" | "info" | "dim";

export function Pill({ children, tone = "info" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={cn("pill", tone)}>{children}</span>;
}
