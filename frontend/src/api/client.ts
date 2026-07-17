import type { ZodType } from "zod";
import { appBridge } from "./appBridge";

/** Normalized backend error: `{ error: { code, message } }` → thrown here. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Optional structured payload from the backend error (e.g. affected ids). */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const TOKEN_KEY = "token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions<T> {
  method?: string;
  body?: unknown;
  /** Zod schema to parse the response with; omit for empty (204) responses. */
  schema?: ZodType<T>;
  query?: Record<string, string | number | undefined>;
}

/**
 * Where the API lives, as a prefix to put in front of `/api`.
 *
 * Empty in dev, preview and tests: the Vite proxy makes the API same-origin, so
 * a relative path is both correct and the reason a phone only ever talks to the
 * Vite port. A static production build has no proxy behind it, so there it is an
 * absolute origin and the backend must allow it via `CORS_ORIGIN`.
 *
 * Trailing slashes are stripped for the same reason `PUBLIC_BASE_URL` does it:
 * this is hand-pasted into a hosting dashboard, and "…onrender.com/" would build
 * "…onrender.com//api/…".
 */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/+$/, "");

/** Absolute or same-origin URL for an API path. Also used by the SSE stream. */
export function apiUrl(path: string): string {
  return `${API_ORIGIN}/api${path}`;
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = apiUrl(path);
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = "GET", body, schema, query } = options;
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Keine Verbindung zum Server");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    const apiError = new ApiError(
      res.status,
      err?.code ?? "ERROR",
      err?.message ?? "Etwas ist schiefgelaufen",
      err?.details,
    );
    handleGlobal(apiError);
    throw apiError;
  }

  if (schema) return schema.parse(payload);
  return payload as T;
}

/** 401 → sign out; 403 REFEREE_PENDING → pending screen (no sign-out). */
function handleGlobal(error: ApiError): void {
  if (error.status === 401) {
    clearToken();
    appBridge.onUnauthorized();
  } else if (error.status === 403 && error.code === "REFEREE_PENDING") {
    appBridge.onRefereePending();
  }
}
