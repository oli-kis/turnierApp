import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { createRegistration } from "../../api/endpoints/registrations";
import { ApiError } from "../../api/client";
import { useTournament } from "../../api/queries";
import { isRegistrationOpen } from "../../lib/registration";
import { formatChf } from "../../lib/money";
import { Button } from "../../components/Button";
import { CardSkeleton } from "../../components/Skeleton";
import { EmptyState, ErrorState } from "../../components/EmptyState";

/**
 * „Team anmelden" — the club's entry-fee funnel, three steps on one route.
 *
 * Mobile-first because that is where it will be filled in: a coach on a phone,
 * once, probably in the evening. Every step is one decision.
 */

const DRAFT_KEY = "registration.draft.v1";

interface Draft {
  tournamentId: string;
  categoryId: string;
  teamName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

const EMPTY: Omit<Draft, "tournamentId"> = {
  categoryId: "",
  teamName: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
};

/**
 * The form survives the trip to Stripe and back.
 *
 * `cancel_url` returns here as a fresh page load, so without this a payer who
 * has second thoughts about the payment method — or whose TWINT app fumbles the
 * hand-off — retypes everything. sessionStorage, not local: this is one sitting.
 */
function loadDraft(tournamentId: string): Omit<Draft, "tournamentId"> {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Draft;
    return parsed.tournamentId === tournamentId ? { ...EMPTY, ...parsed } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage refused (private mode, quota). The form still works; only the
    // trip back from Stripe loses it.
  }
}

export function clearRegistrationDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // nothing to do
  }
}

type Step = "category" | "contact" | "pay";

export function Register() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: tournament, isLoading } = useTournament(id);

  const [form, setForm] = useState(() => loadDraft(id ?? ""));
  const [step, setStep] = useState<Step>("category");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (id) saveDraft({ tournamentId: id, ...form });
  }, [id, form]);

  // Coming back from a cancelled checkout: the draft is filled in, so put the
  // payer back where they left off rather than at step one.
  useEffect(() => {
    if (form.categoryId && form.teamName && step === "category") setStep("pay");
    // Only on mount — later edits drive the step themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useMutation({
    mutationFn: () =>
      createRegistration({
        tournamentId: id!,
        categoryId: form.categoryId,
        teamName: form.teamName.trim(),
        contactName: form.contactName.trim(),
        contactEmail: form.contactEmail.trim(),
        contactPhone: form.contactPhone.trim(),
      }),
    onSuccess: (res) => {
      // Leaving the SPA for Stripe's hosted page. `assign`, not `replace`, so the
      // browser Back button still returns here.
      window.location.assign(res.checkoutUrl);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "TEAM_NAME_TAKEN") {
        setFieldError("Dieser Teamname ist in dieser Kategorie bereits vergeben.");
        setStep("contact");
      }
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <CardSkeleton />
      </div>
    );
  }
  if (!tournament || !id) {
    return (
      <div className="p-4">
        <ErrorState message="Turnier konnte nicht geladen werden." />
      </div>
    );
  }

  const categories = tournament.categories ?? [];

  if (!isRegistrationOpen(tournament)) {
    return (
      <div className="p-4">
        <EmptyState
          title="Anmeldung geschlossen"
          hint="Für dieses Turnier können keine Teams mehr angemeldet werden."
        />
      </div>
    );
  }

  if (tournament.entryFeeRp <= 0 || categories.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          title="Anmeldung noch nicht bereit"
          hint="Die Turnierleitung richtet die Anmeldung gerade ein. Bitte später nochmals versuchen."
        />
      </div>
    );
  }

  const category = categories.find((c) => c.id === form.categoryId);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === "teamName") setFieldError(null);
  };

  const contactValid =
    form.teamName.trim().length >= 2 &&
    form.teamName.trim().length <= 40 &&
    form.contactName.trim().length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contactEmail.trim()) &&
    form.contactPhone.trim().length > 0;

  const genericError =
    submit.error instanceof ApiError && submit.error.code !== "TEAM_NAME_TAKEN"
      ? submit.error.message
      : submit.error
        ? "Anmeldung konnte nicht gestartet werden. Bitte nochmals versuchen."
        : null;

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <header>
        <h1 className="font-display text-2xl font-extrabold">Team anmelden</h1>
        <p className="mt-1 text-[var(--color-ink)]/70">{tournament.name}</p>
      </header>

      <StepDots step={step} />

      {step === "category" && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">1. Kategorie wählen</h2>
          {/* Shown once, prominently: the fee is identical everywhere, so
              repeating it per card would only invite the question "is this one
              different?". */}
          <p className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-3 font-display text-lg font-extrabold tabular-nums">
            Startgeld: {formatChf(tournament.entryFeeRp)}
          </p>
          <div className="space-y-2">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  set("categoryId", c.id);
                  setStep("contact");
                }}
                className={[
                  "flex min-h-14 w-full items-center justify-between rounded-[var(--radius-card)] border bg-white px-4 text-left font-semibold",
                  form.categoryId === c.id
                    ? "border-[var(--color-pine)]"
                    : "border-[var(--color-line)]",
                ].join(" ")}
              >
                <span>{c.name}</span>
                <span aria-hidden className="text-[var(--color-pine)]">
                  ›
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "contact" && (
        <section className="space-y-4">
          <h2 className="font-display text-lg font-bold">2. Team &amp; Kontakt</h2>
          <Field
            label="Teamname"
            value={form.teamName}
            onChange={(v) => set("teamName", v)}
            error={fieldError}
            hint="2–40 Zeichen. So erscheint das Team auf dem Spielplan."
            autoFocus
          />
          <Field
            label="Kontaktperson"
            value={form.contactName}
            onChange={(v) => set("contactName", v)}
          />
          <Field
            label="E-Mail"
            type="email"
            inputMode="email"
            value={form.contactEmail}
            onChange={(v) => set("contactEmail", v)}
            hint="An diese Adresse geht die Bestätigung."
          />
          <Field
            label="Telefon"
            type="tel"
            inputMode="tel"
            value={form.contactPhone}
            onChange={(v) => set("contactPhone", v)}
          />
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setStep("category")}>
              Zurück
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!contactValid}
              onClick={() => setStep("pay")}
            >
              Weiter
            </Button>
          </div>
        </section>
      )}

      {step === "pay" && (
        <section className="space-y-4">
          <h2 className="font-display text-lg font-bold">3. Bezahlen</h2>
          <dl className="divide-y divide-[var(--color-line)] rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-4">
            <Row label="Team" value={form.teamName} />
            <Row label="Kategorie" value={category?.name ?? "—"} />
            <Row label="Kontakt" value={form.contactName} />
            <Row label="E-Mail" value={form.contactEmail} />
            <Row label="Telefon" value={form.contactPhone} />
            <Row label="Startgeld" value={formatChf(tournament.entryFeeRp)} strong />
          </dl>

          {genericError && (
            <p role="alert" className="font-semibold text-[var(--color-loss)]">
              {genericError}
            </p>
          )}

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Einen Moment…" : "Weiter zur Zahlung"}
          </Button>
          <p className="text-sm text-[var(--color-ink)]/70">
            Zahlung per TWINT, Karte, Apple Pay oder Google Pay. Der Platz ist 30 Minuten
            reserviert.
          </p>
          <Button variant="ghost" className="w-full" onClick={() => setStep("contact")}>
            Angaben ändern
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => navigate(`/t/${id}`)}>
            Abbrechen
          </Button>
        </section>
      )}
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const steps: Step[] = ["category", "contact", "pay"];
  const index = steps.indexOf(step);
  return (
    <ol className="flex gap-2" aria-label={`Schritt ${index + 1} von 3`}>
      {steps.map((s, i) => (
        <li
          key={s}
          aria-current={s === step ? "step" : undefined}
          className={[
            "h-1.5 flex-1 rounded-full",
            i <= index ? "bg-[var(--color-pine)]" : "bg-[var(--color-line)]",
          ].join(" ")}
        />
      ))}
    </ol>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-[var(--color-ink)]/70">{label}</dt>
      <dd
        className={[
          "min-w-0 truncate text-right",
          strong ? "font-display font-extrabold tabular-nums" : "font-semibold",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  inputMode,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: string;
  type?: string;
  inputMode?: "email" | "tel";
  autoFocus?: boolean;
}) {
  const id = `field-${label.replace(/\W/g, "").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "h-12 w-full rounded-lg border bg-white px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pine)]",
          error ? "border-[var(--color-loss)]" : "border-[var(--color-line)]",
        ].join(" ")}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-semibold text-[var(--color-loss)]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-[var(--color-ink)]/60">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
