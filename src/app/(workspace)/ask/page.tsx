import { Suspense } from "react";
import { AskPage } from "@/features/ask/ask-page";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--background)] dark:bg-[var(--background)]" />}>
      <AskPage />
    </Suspense>
  );
}
