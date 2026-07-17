import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPushPublicKey } from "../api/endpoints/push";
import { currentSubscription, disablePush, enablePush, pushSupport } from "../lib/push";
import { useToast } from "./Toast";
import { Button } from "./Button";

/**
 * „Benachrichtigungen" — the referee's opt-in for push.
 *
 * Sits at the bottom of `/ref`, below the matches, for the same reason the
 * install prompt does: nothing outranks the schedule on that screen.
 *
 * It renders nothing at all unless push is genuinely available — the backend has
 * VAPID keys, the browser has the APIs, and the referee hasn't already said no
 * at the system level. An offer that cannot be honoured is worse than no offer.
 */

type State = "loading" | "off" | "on" | "denied";

export function NotificationPrompt({ className = "" }: { className?: string }) {
  const toast = useToast();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  // Whether the deployment has push configured at all. Cached for the session:
  // it cannot change under a running client.
  const { data: config } = useQuery({
    queryKey: ["push", "config"],
    queryFn: getPushPublicKey,
    staleTime: Infinity,
    retry: false,
  });

  const support = pushSupport();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (support !== "ready") return;
      // The browser is the authority on whether this device is subscribed —
      // permission can be revoked in system settings without telling us.
      const denied = Notification.permission === "denied";
      const sub = await currentSubscription();
      if (cancelled) return;
      setState(denied ? "denied" : sub ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, [support]);

  if (!config?.enabled) return null;

  // On iOS push exists only in an installed PWA. Saying so is useful; offering a
  // toggle that silently fails is not. InstallPrompt sits on this same screen
  // and is the way out.
  if (support === "needs-install") {
    return (
      <div
        className={`rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4 ${className}`}
      >
        <p className="font-display font-extrabold">Benachrichtigungen</p>
        <p className="mt-1 text-sm text-[var(--color-ink)]/70">
          Auf dem iPhone erst möglich, wenn die App auf dem Home-Bildschirm liegt.
        </p>
      </div>
    );
  }

  if (support === "unsupported" || state === "loading") return null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (state === "on") {
        await disablePush();
        setState("off");
        toast.show("Benachrichtigungen aus", "info");
        return;
      }
      const result = await enablePush();
      if (result === "subscribed") {
        setState("on");
        toast.show("Benachrichtigungen an", "info");
      } else if (result === "denied") {
        setState("denied");
      } else {
        toast.show("Benachrichtigungen sind auf diesem Gerät nicht verfügbar", "error");
      }
    } catch {
      toast.show("Hat nicht geklappt — bitte nochmal versuchen", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4 ${className}`}
    >
      <p className="font-display font-extrabold">Benachrichtigungen</p>
      <p className="mt-1 text-sm text-[var(--color-ink)]/70">
        {state === "denied"
          ? "In den Einstellungen deines Browsers blockiert — dort wieder erlauben."
          : state === "on"
            ? "Du wirst benachrichtigt, wenn du eingeteilt wirst und wenn dein Spiel dran ist."
            : "Wir sagen dir Bescheid, wenn du eingeteilt wirst und wenn dein Spiel dran ist."}
      </p>
      {state !== "denied" && (
        <Button
          variant={state === "on" ? "secondary" : "primary"}
          className="mt-3 w-full"
          onClick={() => void toggle()}
          disabled={busy}
        >
          {state === "on" ? "Ausschalten" : "Einschalten"}
        </Button>
      )}
    </div>
  );
}
