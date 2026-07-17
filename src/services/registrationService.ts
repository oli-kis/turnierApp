import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { sendCollisionRefundNotice, sendRegistrationConfirmation } from "./mailer.js";
import {
  HOLD_MINUTES,
  createCheckoutSession,
  isStripeConfigured,
  refundSession,
} from "./stripeService.js";
import { broadcaster } from "../sse/broadcaster.js";

/**
 * Team self-service registration.
 *
 * The governing rule: **a Team exists only after payment succeeded.** Until then
 * a Registration is the sole record of the intent, and it holds the team name so
 * two clubs cannot check out under the same name at once.
 */

/** Prisma's unique-constraint violation (P2002), without importing the error class. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/** Registration is open when the flag is on and any deadline is still ahead. */
export function isRegistrationOpen(
  t: { registrationOpen: boolean; registrationDeadline: Date | null },
  now = new Date(),
): boolean {
  return t.registrationOpen && (t.registrationDeadline === null || now < t.registrationDeadline);
}

/**
 * Names that block a new registration in this category: existing Teams, plus
 * registrations that are PAID or still holding their 30-minute slot.
 *
 * Compared lower-cased in JS rather than by the database on purpose — Prisma's
 * `mode: "insensitive"` is Postgres-only and this schema also runs on SQLite, so
 * a query-level match would quietly become case-*sensitive* in dev and behave
 * differently from production. The sets here are a few dozen rows per category.
 */
async function takenNames(categoryId: string, now = new Date()): Promise<Set<string>> {
  const [teams, registrations] = await Promise.all([
    prisma.team.findMany({ where: { categoryId }, select: { name: true } }),
    prisma.registration.findMany({
      where: {
        categoryId,
        OR: [{ status: "PAID" }, { status: "PENDING_PAYMENT", expiresAt: { gt: now } }],
      },
      select: { teamName: true },
    }),
  ]);
  return new Set([
    ...teams.map((t) => t.name.trim().toLowerCase()),
    ...registrations.map((r) => r.teamName.trim().toLowerCase()),
  ]);
}

export interface CreateRegistrationInput {
  tournamentId: string;
  categoryId: string;
  teamName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

export interface CreateRegistrationResult {
  registrationId: string;
  checkoutUrl: string;
}

export async function createRegistration(
  input: CreateRegistrationInput,
): Promise<CreateRegistrationResult> {
  const tournament = await prisma.tournament.findUnique({ where: { id: input.tournamentId } });
  if (!tournament) throw Errors.notFound("Tournament");

  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category || category.tournamentId !== tournament.id) {
    throw Errors.badRequest("Category must belong to this tournament");
  }

  if (!isRegistrationOpen(tournament)) {
    throw Errors.conflict("REGISTRATION_CLOSED", "Registration is closed for this tournament");
  }
  if (tournament.entryFeeRp <= 0) {
    throw Errors.conflict("REGISTRATION_NOT_CONFIGURED", "No entry fee is configured");
  }
  // Same code as a missing fee: from the payer's side both mean "the club has
  // not finished setting registration up", and neither is their problem to fix.
  if (!isStripeConfigured()) {
    throw Errors.conflict("REGISTRATION_NOT_CONFIGURED", "Payment is not configured");
  }

  const teamName = input.teamName.trim();
  if ((await takenNames(input.categoryId)).has(teamName.toLowerCase())) {
    throw Errors.conflict("TEAM_NAME_TAKEN", "This team name is already taken in this category");
  }

  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);

  // Created before the session so the session can carry its id, then updated
  // with the real session id. The placeholder is unique per row, so the
  // stripeSessionId unique index holds even between these two writes.
  const registration = await prisma.registration.create({
    data: {
      tournamentId: tournament.id,
      categoryId: category.id,
      teamName,
      contactName: input.contactName.trim(),
      contactEmail: input.contactEmail.trim(),
      contactPhone: input.contactPhone.trim(),
      status: "PENDING_PAYMENT",
      amountRp: tournament.entryFeeRp,
      stripeSessionId: `pending:${crypto.randomUUID()}`,
      expiresAt,
    },
  });

  try {
    const session = await createCheckoutSession({
      registrationId: registration.id,
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      categoryName: category.name,
      amountRp: registration.amountRp,
      contactEmail: registration.contactEmail,
      expiresAt,
    });
    await prisma.registration.update({
      where: { id: registration.id },
      data: { stripeSessionId: session.sessionId },
    });
    return { registrationId: registration.id, checkoutUrl: session.url };
  } catch (err) {
    // No session means no way to ever pay this row, and leaving it PENDING would
    // hold the team name hostage for 30 minutes for nothing.
    await prisma.registration.delete({ where: { id: registration.id } }).catch(() => {});
    throw err;
  }
}

/**
 * `checkout.session.completed` — the only place a Team is born.
 *
 * Idempotent: Stripe retries, and a retry of a fulfilment that already happened
 * must be a no-op, not a second team.
 */
export async function fulfilRegistration(registrationId: string): Promise<void> {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { category: true, tournament: true },
  });
  if (!registration) return; // unknown id — nothing to do, ack the webhook

  // Already fulfilled (or resolved some other way): do nothing.
  if (registration.status !== "PENDING_PAYMENT") return;

  try {
    await prisma.$transaction(async (tx) => {
      // Re-checked here, not only at POST time: the name may have been taken
      // while this payer sat on Stripe's page. This catches case-*differing*
      // collisions ("Juniors" vs "juniors"), which the unique index — an exact
      // match — cannot; the index then catches the identical-name race that
      // slips between this read and the insert. Both land in the same handler.
      const existing = await tx.team.findMany({
        where: { categoryId: registration.categoryId },
        select: { name: true },
      });
      if (existing.some((t) => t.name.trim().toLowerCase() === registration.teamName.toLowerCase())) {
        throw Object.assign(new Error("team name taken"), { code: "P2002" });
      }

      const team = await tx.team.create({
        data: {
          categoryId: registration.categoryId,
          groupId: null, // the unassigned pool; the admin places it in setup
          name: registration.teamName,
        },
      });
      await tx.registration.update({
        where: { id: registration.id },
        data: { status: "PAID", paidAt: new Date(), teamId: team.id },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      await handleNameCollision(registration.id);
      return;
    }
    throw err;
  }

  sendRegistrationConfirmation({
    to: registration.contactEmail,
    contactName: registration.contactName,
    teamName: registration.teamName,
    categoryName: registration.category.name,
    tournamentName: registration.tournament.name,
    tournamentStart: registration.tournament.startAt,
    amountRp: registration.amountRp,
  });
  broadcaster.broadcast(registration.tournamentId, "registration.paid", {
    registrationId: registration.id,
  });
}

/**
 * Two teams paid for the same name; this one lost. They have been charged for a
 * team that cannot exist, so refund them and say so.
 *
 * Never throws: this runs inside the webhook, and a failed refund must not make
 * Stripe retry a fulfilment. A refund that fails here is logged and left for the
 * dashboard — the admin list shows the session link.
 */
async function handleNameCollision(registrationId: string): Promise<void> {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { category: true },
  });
  if (!registration) return;

  try {
    await refundSession(registration.stripeSessionId);
  } catch (err) {
    console.error(
      `[registration] refund failed for ${registrationId} (${registration.stripeSessionId}) — refund by hand in the Stripe dashboard:`,
      err,
    );
  }

  await prisma.registration.update({
    where: { id: registrationId },
    data: { status: "CANCELED" },
  });

  sendCollisionRefundNotice({
    to: registration.contactEmail,
    contactName: registration.contactName,
    teamName: registration.teamName,
    categoryName: registration.category.name,
    amountRp: registration.amountRp,
  });
}

/** `checkout.session.expired` — the hold lapsed, free the name. */
export async function expireRegistration(registrationId: string): Promise<void> {
  const registration = await prisma.registration.findUnique({ where: { id: registrationId } });
  if (!registration || registration.status !== "PENDING_PAYMENT") return; // idempotent
  await prisma.registration.update({
    where: { id: registrationId },
    data: { status: "EXPIRED" },
  });
}

/**
 * Admin cancel of a PAID registration: deletes the Team and marks CANCELED.
 *
 * Only while the team is still unassigned and unscheduled — once it is in a
 * group with matches, removing it silently would tear a hole in the schedule.
 * The money is refunded by hand in the Stripe dashboard (v1); the caller shows
 * the session link.
 */
export async function cancelRegistration(registrationId: string): Promise<void> {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { team: true },
  });
  if (!registration) throw Errors.notFound("Registration");
  if (registration.status !== "PAID") {
    throw Errors.conflict("REGISTRATION_NOT_PAID", "Only a paid registration can be canceled");
  }

  if (registration.teamId) {
    const team = registration.team;
    if (team?.groupId) {
      throw Errors.conflict(
        "TEAM_ASSIGNED",
        "Remove the team from its group before canceling the registration",
      );
    }
    const matches = await prisma.match.count({
      where: { OR: [{ homeTeamId: registration.teamId }, { awayTeamId: registration.teamId }] },
    });
    if (matches > 0) {
      throw Errors.conflict("TEAM_SCHEDULED", "The team already has matches; cancel is blocked");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.registration.update({
      where: { id: registrationId },
      data: { status: "CANCELED", teamId: null },
    });
    if (registration.teamId) {
      await tx.team.delete({ where: { id: registration.teamId } });
    }
  });
}

/** Shape returned to the public status page — deliberately no contact data. */
export interface PublicStatus {
  status: string;
  teamName: string;
  categoryName: string;
}

export async function publicStatus(registrationId: string): Promise<PublicStatus> {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { category: true },
  });
  if (!registration) throw Errors.notFound("Registration");
  return {
    status: registration.status,
    teamName: registration.teamName,
    categoryName: registration.category.name,
  };
}

export type RegistrationWhere = Prisma.RegistrationWhereInput;
