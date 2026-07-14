import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { login as loginRequest } from "../../api/endpoints/auth";
import { ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/Button";

/** Shared login; routes by role after success. `mode` only tweaks copy/links. */
export function Login({ mode = "admin" }: { mode?: "admin" | "referee" }) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => loginRequest(email, password),
    onSuccess: ({ token, user }) => {
      login(token, user);
      navigate(user.role === "ADMIN" ? "/admin" : "/ref", { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  // REFEREE_PENDING/REJECTED are handled globally (routed to the pending screen);
  // show everything else inline.
  const err = mutation.error;
  const inlineError =
    err instanceof ApiError && !(err.status === 403 && err.code === "REFEREE_PENDING")
      ? err.message
      : null;

  return (
    <AuthShell title={mode === "referee" ? "Schiedsrichter-Login" : "Anmelden"}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="E-Mail" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Passwort"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {inlineError && <p className="text-sm font-semibold text-[var(--color-loss)]">{inlineError}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? "Anmelden…" : "Anmelden"}
        </Button>
      </form>

      {mode === "referee" && (
        <p className="mt-4 text-center text-sm">
          Noch kein Konto?{" "}
          <Link to="/ref/registrieren" className="font-semibold text-[var(--color-pine)]">
            Registrieren
          </Link>
        </p>
      )}
    </AuthShell>
  );
}

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pine)]">FC Frick Turnier</p>
      <h1 className="mb-6 font-display text-3xl font-extrabold">{title}</h1>
      {children}
      <p className="mt-8 text-center text-sm">
        <Link to="/" className="text-[var(--color-ink)]/60">
          ← Zur Turnierübersicht
        </Link>
      </p>
    </div>
  );
}

export function Field({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-4 py-3 text-base outline-none focus:border-[var(--color-pine)]"
      />
    </label>
  );
}
