import { Suspense } from "react";
import { PremiumSystemConfigurationBoundary } from "@/components/app/premium-configuration-gate";
import { AskPremiumPage } from "@/features/ask/ask-premium-page";

export default function Page() {
  return (
    <Suspense fallback={<div className="premium-theme ask-premium-page min-h-screen bg-[var(--premium-bg)]" />}>
      <PremiumSystemConfigurationBoundary>
        <AskPremiumPage />
      </PremiumSystemConfigurationBoundary>
    </Suspense>
  );
}
