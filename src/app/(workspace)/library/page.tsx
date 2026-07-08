import { PremiumSystemConfigurationBoundary } from "@/components/app/premium-configuration-gate";
import { LibraryPremiumPage } from "@/features/library/library-premium-page";

export default function Page() {
  return (
    <PremiumSystemConfigurationBoundary>
      <LibraryPremiumPage />
    </PremiumSystemConfigurationBoundary>
  );
}
