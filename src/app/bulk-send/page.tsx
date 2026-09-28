import BulkSend from "@/components/BulkSend";
import { SetupNotice, errorText } from "@/components/ui";
import { emailConfigured, env } from "@/lib/env";
import { loadUnsent } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function BulkSendPage() {
  let rows;
  try {
    rows = await loadUnsent();
  } catch (err) {
    return <SetupNotice error={errorText(err)} />;
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Bulk send</h1>
        <p className="text-sm text-muted">
          Every unsent draft. Nothing is pre-ticked - tick what you&apos;ve decided, then confirm.
          {env.sendMode === "test" && <> Test mode: all emails go to <strong>{env.testRecipient || "(TEST_RECIPIENT_EMAIL not set)"}</strong>.</>}
        </p>
      </div>
      <BulkSend rows={rows} emailConfigured={emailConfigured()} />
    </div>
  );
}
