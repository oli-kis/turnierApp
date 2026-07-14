import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { CardSkeleton } from "../components/Skeleton";

/** Gate a subtree by role; redirect to the appropriate login otherwise. */
export function ProtectedRoute({
  role,
  children,
}: {
  role: "ADMIN" | "REFEREE";
  children: ReactNode;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-md p-4">
        <CardSkeleton />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={role === "ADMIN" ? "/login" : "/ref/login"} replace />;
  }

  if (user.role !== role) {
    // Signed in with the wrong role — send to that role's home.
    return <Navigate to={user.role === "ADMIN" ? "/admin" : "/ref"} replace />;
  }

  return <>{children}</>;
}
