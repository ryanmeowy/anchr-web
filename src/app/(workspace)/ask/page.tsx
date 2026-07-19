import { Suspense } from "react";
import { PremiumSystemConfigurationBoundary } from "@/components/app/premium-configuration-gate";
import { AskPremiumPage } from "@/features/ask/ask-premium-page";

function AskPageFallback() {
  return (
    <div
      className="premium-theme ask-premium-page ask-premium-ask-page min-h-screen overflow-hidden"
      data-theme="dark"
      data-premium-theme="dark"
    >
      <div
        className="ask-premium-route-fallback h-screen"
        role="status"
        aria-label="正在加载 Ask"
        aria-busy="true"
      >
        <div className="ask-premium-route-fallback-rail" aria-hidden="true" />
        <div className="ask-premium-route-fallback-history" aria-hidden="true" />
        <div className="ask-premium-route-fallback-main" aria-hidden="true" />
        <div className="ask-premium-route-fallback-trace" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<AskPageFallback />}>
      <PremiumSystemConfigurationBoundary>
        <AskPremiumPage />
      </PremiumSystemConfigurationBoundary>
    </Suspense>
  );
}
