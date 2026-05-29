import { AppShell } from "@/components/AppShell";
import { DocumentsBrowser } from "@/components/DocumentsBrowser";

export default function DocumentsPage() {
  return (
    <AppShell title="Document Transfer">
      <DocumentsBrowser />
    </AppShell>
  );
}
