import { cn } from "@/lib/cn";

type Status = "ok" | "warn" | "crit" | "info" | "dim";

export function KpiTile({
  label,
  value,
  status = "info",
  sub,
}: {
  label: string;
  value: string | number;
  status?: Status;
  sub?: string;
}) {
  return (
    <div className={cn("kpi-tile", status)}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}
