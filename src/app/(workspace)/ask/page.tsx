import { Suspense } from "react";
import { AskPremiumPage } from "@/features/ask/ask-premium-page";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--background)] dark:bg-[var(--background)]" />}>
      <AskPremiumPage />
    </Suspense>
  );
}
