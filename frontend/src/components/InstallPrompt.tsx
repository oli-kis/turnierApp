import { useEffect, useState } from "react";
import { Button } from "./Button";

/**
 * „App installieren" — offered where it pays off: the referee home (a home-screen
 * icon beats finding a URL with gloves on) and the public tournament home (what
 * parents keep open all day).
 *
 * Chrome/Edge/Android fire `beforeinstallprompt` and let us trigger the real
 * install dialog. iOS Safari has no such event and can only be installed by
 * hand, so it gets instructions instead of a button that cannot work.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "installPrompt.dismissed";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's non-standard flag — the only way to detect it there.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallPrompt({ className = "" }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => wasDismissed());
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the browser's own mini-infobar out of the way
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage refused; the prompt simply returns next visit.
    }
  };

  if (dismissed || isStandalone()) return null;

  const installable = deferred !== null;
  const iosFallback = !installable && isIosSafari();
  if (!installable && !iosFallback) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === "accepted") setDismissed(true);
  };

  return (
    <div
      className={`rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display font-extrabold">App installieren</p>
          <p className="mt-1 text-sm text-[var(--color-ink)]/70">
            {iosFallback
              ? "Teilen-Symbol antippen, dann „Zum Home-Bildschirm“."
              : "Auf den Home-Bildschirm legen — schneller offen, auch bei schlechtem Empfang."}
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Hinweis schliessen"
          className="-m-2 flex h-12 w-12 shrink-0 items-center justify-center text-xl font-bold text-[var(--color-ink)]/50"
        >
          ×
        </button>
      </div>

      {installable && (
        <Button variant="primary" className="mt-3 w-full" onClick={install}>
          Installieren
        </Button>
      )}

      {iosFallback && showIosHint && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-[var(--color-ink)]/70">
          <li>Unten in der Leiste auf das Teilen-Symbol tippen.</li>
          <li>„Zum Home-Bildschirm“ wählen.</li>
          <li>Mit „Hinzufügen“ bestätigen.</li>
        </ol>
      )}
      {iosFallback && !showIosHint && (
        <Button variant="secondary" className="mt-3 w-full" onClick={() => setShowIosHint(true)}>
          So geht's
        </Button>
      )}
    </div>
  );
}
