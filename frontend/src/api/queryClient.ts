import { QueryClient, MutationCache, QueryCache } from "@tanstack/react-query";
import { ApiError } from "./client";
import { appBridge } from "./appBridge";

/**
 * A 409 is a legal tournament-day race (someone else pressed first) — surface
 * the backend message as a toast, never a blank screen. REFEREE_PENDING routes
 * to the pending screen. Other errors are handled locally by the screen.
 */
function globalErrorToast(error: unknown): void {
  if (!(error instanceof ApiError)) return;
  if (error.status === 409) {
    appBridge.toast(error.message, "error");
  } else if (error.status === 403 && error.code === "REFEREE_PENDING") {
    appBridge.onRefereePending();
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (failureCount, error) => {
        // Don't retry auth/permission/validation errors; do retry flaky network.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => globalErrorToast(error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => globalErrorToast(error),
  }),
});
