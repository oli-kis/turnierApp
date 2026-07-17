import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelRegistration } from "../../api/endpoints/registrations";
import { ApiError } from "../../api/client";
import { useRegistrations, qk } from "../../api/queries";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { Tag } from "../../components/Tag";
import { TableSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { formatChf } from "../../lib/money";
import { formatDateTime } from "../../lib/time";
import type { Registration, RegistrationStatus } from "../../api/types";

/**
 * Admin → Anmeldungen. Who has registered, who has paid, and who to phone.
 *
 * This is the only screen in the app that shows contact data, and the only one
 * that touches money — so it is deliberately plain: a table you can read down,
 * and one destructive action that says exactly what it does and does not do.
 */

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING_PAYMENT: "Zahlung offen",
  PAID: "Bezahlt",
  EXPIRED: "Abgelaufen",
  CANCELED: "Storniert",
};

export function RegistrationsSection({ tournamentId }: { tournamentId: string }) {
  const { data, isLoading } = useRegistrations(tournamentId);
  const [toCancel, setToCancel] = useState<Registration | null>(null);

  if (isLoading) return <TableSkeleton rows={3} />;

  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="Noch keine Anmeldungen"
        hint="Sobald die Anmeldung offen ist und ein Team bezahlt, erscheint es hier."
      />
    );
  }

  const paid = data.filter((r) => r.status === "PAID");
  const takings = paid.reduce((sum, r) => sum + r.amountRp, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-ink)]/70 tabular-nums">
        {paid.length} bezahlt · {formatChf(takings)} eingenommen
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left">
              <Th>Team</Th>
              <Th>Kategorie</Th>
              <Th>Kontakt</Th>
              <Th>Status</Th>
              <Th>Bezahlt</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="border-b border-[var(--color-line)] align-top">
                <Td>
                  <span className="font-semibold">{r.teamName}</span>
                  <span className="block text-xs text-[var(--color-ink)]/60 tabular-nums">
                    {formatChf(r.amountRp)}
                  </span>
                </Td>
                <Td>{r.categoryName}</Td>
                <Td>
                  <span className="block">{r.contactName}</span>
                  {/* Tournament day is a phone-call day: make both tappable. */}
                  <a
                    href={`mailto:${r.contactEmail}`}
                    className="block text-xs font-semibold text-[var(--color-pine)]"
                  >
                    {r.contactEmail}
                  </a>
                  <a
                    href={`tel:${r.contactPhone.replace(/\s/g, "")}`}
                    className="block text-xs font-semibold text-[var(--color-pine)] tabular-nums"
                  >
                    {r.contactPhone}
                  </a>
                </Td>
                <Td>
                  <Tag tone={r.status === "PAID" ? "win" : "neutral"}>{STATUS_LABEL[r.status]}</Tag>
                </Td>
                <Td className="tabular-nums">{r.paidAt ? formatDateTime(r.paidAt) : "—"}</Td>
                <Td>
                  <div className="flex flex-col items-end gap-1">
                    <a
                      href={r.stripeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-[var(--color-pine)]"
                    >
                      Zahlung ↗
                    </a>
                    {r.status === "PAID" && (
                      <button
                        onClick={() => setToCancel(r)}
                        className="text-xs font-semibold text-[var(--color-loss)]"
                      >
                        Stornieren
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CancelSheet
        tournamentId={tournamentId}
        registration={toCancel}
        onClose={() => setToCancel(null)}
      />
    </div>
  );
}

/**
 * Cancelling deletes the team but does **not** move the money — refunds are
 * manual in the Stripe dashboard. Saying so here, next to the button, is the
 * whole point: an admin who assumes the refund happened leaves a club out of
 * pocket and never finds out.
 */
function CancelSheet({
  tournamentId,
  registration,
  onClose,
}: {
  tournamentId: string;
  registration: Registration | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const cancel = useMutation({
    mutationFn: () => cancelRegistration(registration!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.registrationLists(tournamentId) });
      qc.invalidateQueries({ queryKey: qk.tournament(tournamentId) });
      toast.show("Anmeldung storniert — Rückerstattung in Stripe nicht vergessen", "success");
      onClose();
    },
    onError: (err) => {
      toast.show(
        err instanceof ApiError ? err.message : "Stornieren nicht möglich",
        "error",
      );
    },
  });

  return (
    <Sheet open={!!registration} onClose={onClose} title="Anmeldung stornieren?">
      {registration && (
        <div className="space-y-4">
          <p className="text-[var(--color-ink)]/70">
            <strong>{registration.teamName}</strong> ({registration.categoryName}) wird aus dem
            Turnier entfernt.
          </p>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-live)] bg-white p-3">
            <p className="font-semibold">Das Geld wird nicht automatisch zurückerstattet.</p>
            <p className="mt-1 text-sm text-[var(--color-ink)]/70">
              Die Rückerstattung von {formatChf(registration.amountRp)} muss im Stripe-Dashboard
              ausgelöst werden.
            </p>
            <a
              href={registration.stripeUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm font-semibold text-[var(--color-pine)]"
            >
              Zahlung in Stripe öffnen ↗
            </a>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              size="lg"
              className="flex-1"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Stornieren
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 text-xs font-bold uppercase tracking-wide">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-2 ${className}`}>{children}</td>;
}
