import { AppShell } from "@/components/AppShell";
import { TransferWizard } from "@/components/wizard/TransferWizard";

export default function DocumentTransferPage() {
  return (
    <AppShell title="Document Transfer">
      <TransferWizard />
    </AppShell>
  );
}
