"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ACCESS_TOKEN_CHANGED_EVENT,
  ACCESS_TOKEN_STORAGE_KEY,
  getAccessTokenIdentityKey,
  getConfiguredAccessToken,
} from "@/lib/api-client";
import { clearAllAssetScopeState } from "@/lib/asset-scope";
import { clearAllPreviewNavigation } from "@/lib/preview-context";
import { BackgroundTaskProvider } from "./background-task-provider";

function subscribeAccessToken(callback: () => void) {
  window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getServerAccessToken() {
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [authEpoch, setAuthEpoch] = useState(0);
  const authIdentity = useSyncExternalStore(
    subscribeAccessToken,
    getConfiguredAccessToken,
    getServerAccessToken,
  );
  const authIdentityKey = authIdentity === null ? null : getAccessTokenIdentityKey(authIdentity);
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
    const resetAuthenticatedState = () => {
      void queryClient.cancelQueries();
      queryClient.clear();
      clearAllAssetScopeState();
      clearAllPreviewNavigation();
      window.sessionStorage.removeItem("anchr.search.session-state.v1");
      setAuthEpoch((current) => current + 1);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ACCESS_TOKEN_STORAGE_KEY) {
        resetAuthenticatedState();
      }
    };

    window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, resetAuthenticatedState);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, resetAuthenticatedState);
      window.removeEventListener("storage", handleStorage);
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <BackgroundTaskProvider
        key={`${authEpoch}:${authIdentityKey ?? "pending"}`}
        authIdentityKey={authIdentityKey}
      >
        {children}
      </BackgroundTaskProvider>
    </QueryClientProvider>
  );
}
