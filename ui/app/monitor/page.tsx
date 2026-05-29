import Link from "next/link";
import { Dashboard } from "@/components/Dashboard";

/**
 * Monitor — the original technical dashboard (KPI tiles, detection-tier
 * breakdown, recent-classifications table with live convert progress). Kept
 * verbatim and wrapped in `.monitor-shell` so its self-contained dark styling
 * survives the switch to the light Opus2 default theme.
 */
export default function MonitorPage() {
  return (
    <div className="monitor-shell">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 pt-3 text-[11px]">
        <Link href="/" className="text-slate-400 hover:text-slate-200">
          ‹ Back to Workspaces
        </Link>
      </div>
      <Dashboard />
    </div>
  );
}
