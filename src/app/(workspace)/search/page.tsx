import { PremiumSystemConfigurationBoundary } from "@/components/app/premium-configuration-gate";
import { SearchPremiumPage } from "@/features/search/search-premium-page";

export default function Page() {
  return (
    <PremiumSystemConfigurationBoundary>
      <SearchPremiumPage />
    </PremiumSystemConfigurationBoundary>
  );
}
