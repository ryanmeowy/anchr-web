import { PremiumSystemConfigurationBoundary } from "@/components/app/premium-configuration-gate";
import { ImportsPremiumPage } from "@/features/imports/imports-premium-page";

export default function Page() {
  return (
    <PremiumSystemConfigurationBoundary>
      <ImportsPremiumPage />
    </PremiumSystemConfigurationBoundary>
  );
}
