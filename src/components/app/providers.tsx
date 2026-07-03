"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ACCESS_TOKEN_CHANGED_EVENT, ACCESS_TOKEN_STORAGE_KEY } from "@/lib/api-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 20_000,
          },
        },
      }),
  );

  useEffect(() => {
    const resetAuthenticatedQueries = () => {
      void queryClient.resetQueries();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ACCESS_TOKEN_STORAGE_KEY) {
        resetAuthenticatedQueries();
      }
    };

    window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, resetAuthenticatedQueries);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, resetAuthenticatedQueries);
      window.removeEventListener("storage", handleStorage);
    };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
