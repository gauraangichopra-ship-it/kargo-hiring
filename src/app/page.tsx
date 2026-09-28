import DashboardView from "@/components/DashboardView";
import { SetupNotice, errorText } from "@/components/ui";
import { loadDashboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let data;
  try {
    data = await loadDashboard();
  } catch (err) {
    return <SetupNotice error={errorText(err)} />;
  }
  return <DashboardView rows={data.rows} />;
}
