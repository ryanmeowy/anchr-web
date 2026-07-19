import { PremiumSystemConfigurationBoundary } from "@/components/app/premium-configuration-gate";
import { ImportsPremiumPage } from "@/features/imports/imports-premium-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kbId?: string | string[]; taskId?: string | string[] }>;
}) {
  const params = await searchParams;
  const kbId = Array.isArray(params.kbId) ? params.kbId[0] : params.kbId;
  const taskId = Array.isArray(params.taskId) ? params.taskId[0] : params.taskId;

  return (
    <PremiumSystemConfigurationBoundary>
      <ImportsPremiumPage initialKbId={kbId?.trim()} initialTaskId={taskId?.trim()} />
    </PremiumSystemConfigurationBoundary>
  );
}
