import { PremiumSystemConfigurationBoundary } from "@/components/app/premium-configuration-gate";
import { LibraryPremiumPage } from "@/features/library/library-premium-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kbId?: string | string[] }>;
}) {
  const params = await searchParams;
  const kbId = Array.isArray(params.kbId) ? params.kbId[0] : params.kbId;

  return (
    <PremiumSystemConfigurationBoundary>
      <LibraryPremiumPage openedKnowledgeBaseId={kbId?.trim() || null} />
    </PremiumSystemConfigurationBoundary>
  );
}
