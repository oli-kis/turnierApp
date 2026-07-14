/**
 * Runtime bridge between the non-React API layer and React providers. Providers
 * register handlers on mount; the client and query caches call them. This keeps
 * global 401/403/409 handling in one place without threading context everywhere.
 */
export type ToastKind = "error" | "info" | "success";

interface AppBridge {
  onUnauthorized: () => void;
  onRefereePending: () => void;
  toast: (message: string, kind?: ToastKind) => void;
}

export const appBridge: AppBridge = {
  onUnauthorized: () => {},
  onRefereePending: () => {},
  toast: () => {},
};
