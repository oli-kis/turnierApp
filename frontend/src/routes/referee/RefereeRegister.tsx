import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { register as registerRequest } from "../../api/endpoints/auth";
import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { AuthShell, Field } from "../auth/Login";
import { RefereePending } from "./RefereePending";

export function RefereeRegister() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => registerRequest(email, name, password),
  });

  if (mutation.isSuccess) return <RefereePending />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const err = mutation.error;
  const inlineError = err instanceof ApiError ? err.message : null;

  return (
    <AuthShell title="Registrieren">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name" value={name} onChange={setName} autoComplete="name" />
        <Field label="E-Mail" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Passwort (min. 8 Zeichen)"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        {inlineError && <p className="text-sm font-semibold text-[var(--color-loss)]">{inlineError}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? "Registrieren…" : "Registrieren"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm">
        Schon ein Konto?{" "}
        <Link to="/ref/login" className="font-semibold text-[var(--color-pine)]">
          Anmelden
        </Link>
      </p>
    </AuthShell>
  );
}
