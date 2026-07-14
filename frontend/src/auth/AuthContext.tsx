import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMe } from "../api/endpoints/auth";
import { getToken, setToken, clearToken } from "../api/client";
import { queryClient } from "../api/queryClient";
import { qk } from "../api/queries";
import { appBridge } from "../api/appBridge";
import type { User } from "../api/types";

interface AuthValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isReferee: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken());

  const meQuery = useQuery({
    queryKey: qk.me(),
    queryFn: () => getMe().then((r) => r.user),
    enabled: !!token,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    // A global 401 clears the session; screens react to user becoming null.
    appBridge.onUnauthorized = () => {
      setTokenState(null);
      queryClient.removeQueries({ queryKey: qk.me() });
    };
    return () => {
      appBridge.onUnauthorized = () => {};
    };
  }, []);

  const value: AuthValue = {
    user: token ? meQuery.data ?? null : null,
    isLoading: !!token && meQuery.isLoading,
    isAuthenticated: !!token && !!meQuery.data,
    isAdmin: meQuery.data?.role === "ADMIN",
    isReferee: meQuery.data?.role === "REFEREE",
    login: (t, u) => {
      setToken(t);
      setTokenState(t);
      queryClient.setQueryData(qk.me(), u);
    },
    logout: () => {
      clearToken();
      setTokenState(null);
      queryClient.clear();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
