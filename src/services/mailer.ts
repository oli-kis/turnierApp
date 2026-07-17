import { env } from "../lib/env.js";

/**
 * Outbound email.
 *
 * Deliberately a seam, not an integration (yet): the provider is undecided, so
 * this logs what it would have sent and returns. Wiring Resend or SMTP later is
 * a change to `deliver` alone — nothing above this file knows the difference.
 *
 * The hard rule this shape exists to enforce: **a confirmation email must never
 * fail the thing it confirms.** By the time these run, money has moved and the
 * team is registered. `send` therefore swallows everything; a lost receipt is an
 * annoyance the admin can fix by hand, a 500 in the webhook is Stripe retrying a
 * fulfilment that already happened.
 */

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

function deliver(mail: Mail): void {
  // TODO(provider): Resend (`RESEND_API_KEY`) or SMTP via nodemailer.
  // Until then, log enough that the club can send it by hand if it matters.
  console.info(
    `[mail] would send to ${mail.to}\n  subject: ${mail.subject}\n${mail.body
      .split("\n")
      .map((l) => `  | ${l}`)
      .join("\n")}`,
  );
  if (!env.RESEND_API_KEY) {
    console.info("[mail] no RESEND_API_KEY — logged only, nothing sent.");
  }
}

/** Fire-and-forget. Never throws; see the module comment. */
export function send(mail: Mail): void {
  try {
    deliver(mail);
  } catch (err) {
    console.error("[mail] delivery failed, continuing:", err);
  }
}

function chf(amountRp: number): string {
  return (amountRp / 100).toFixed(2);
}

export interface ConfirmationParams {
  to: string;
  contactName: string;
  teamName: string;
  categoryName: string;
  tournamentName: string;
  tournamentStart: Date;
  amountRp: number;
}

/** „Ihr wart erfolgreich angemeldet." Stripe sends the payment receipt itself. */
export function sendRegistrationConfirmation(p: ConfirmationParams): void {
  const date = new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(p.tournamentStart);

  send({
    to: p.to,
    subject: `Anmeldung bestätigt — ${p.teamName} (${p.tournamentName})`,
    body: [
      `Hallo ${p.contactName}`,
      "",
      `${p.teamName} ist für ${p.tournamentName} angemeldet.`,
      "",
      `Kategorie: ${p.categoryName}`,
      `Datum: ${date}`,
      `Startgeld: CHF ${chf(p.amountRp)} — bezahlt`,
      "",
      "Der Spielplan folgt später auf der Website.",
      "",
      "Bis bald auf dem Platz",
      "FC Frick",
    ].join("\n"),
  });
}

export interface RefundNoticeParams {
  to: string;
  contactName: string;
  teamName: string;
  categoryName: string;
  amountRp: number;
}

/**
 * The apology for the name-collision race: they paid, someone else took the name
 * a moment earlier, and we have refunded them.
 */
export function sendCollisionRefundNotice(p: RefundNoticeParams): void {
  send({
    to: p.to,
    subject: `Anmeldung nicht möglich — ${p.teamName}`,
    body: [
      `Hallo ${p.contactName}`,
      "",
      `Leider hat sich im selben Moment ein anderes Team unter dem Namen „${p.teamName}“`,
      `in der Kategorie ${p.categoryName} angemeldet. Die Anmeldung konnte deshalb nicht`,
      "abgeschlossen werden.",
      "",
      `Das Startgeld von CHF ${chf(p.amountRp)} wurde vollständig zurückerstattet —`,
      "je nach Zahlungsmittel dauert es ein paar Tage, bis es wieder sichtbar ist.",
      "",
      "Meldet euch gerne mit einem anderen Teamnamen nochmals an.",
      "",
      "FC Frick",
    ].join("\n"),
  });
}
