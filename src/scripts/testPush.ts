import { prisma } from "../db/client.js";
import { isPushEnabled, sendToUser } from "../services/pushService.js";

/**
 * Send a test notification to a referee's registered devices.
 *
 *   npm run push:test -- referee@example.ch
 *
 * Exists because the real triggers (assignment, slot opening) need a staged
 * tournament, which makes "did the notification arrive?" and "is my tournament
 * set up right?" fail in the same place. This isolates delivery: same VAPID
 * config, same subscriptions, same send path as production.
 */

async function main(): Promise<number> {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run push:test -- <referee-email>");
    return 1;
  }

  if (!isPushEnabled()) {
    console.error(
      "Push is disabled: no VAPID keypair configured.\n" +
        "Run `npm run push:keys` and paste the output into .env, then restart.",
    );
    return 1;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}.`);
    return 1;
  }

  const subs = await prisma.pushSubscription.count({ where: { userId: user.id } });
  if (subs === 0) {
    console.error(
      `${email} has no registered devices.\n` +
        "On the phone: open /ref over HTTPS, log in, and switch „Benachrichtigungen“ on.",
    );
    return 1;
  }

  console.log(`Sending to ${subs} device(s) for ${email}...`);
  const report = await sendToUser(user.id, {
    title: "Test",
    body: "Push funktioniert. Diese Meldung kommt vom Turnier-Backend.",
    url: "/ref",
    tag: "test",
  });

  console.log(`  delivered to push service: ${report.sent}`);
  if (report.failed > 0) console.log(`  failed: ${report.failed}`);
  if (report.pruned > 0) console.log(`  pruned (dead endpoints removed): ${report.pruned}`);
  for (const err of report.errors) console.log(`  ! ${err}`);

  // "Accepted by the push service" is not "shown on the phone" — the handoff to
  // Apple/Google is where it can still be dropped silently. Say so rather than
  // let a green line imply more than it proves.
  if (report.sent > 0) {
    console.log("\nAccepted by the push service. If nothing appears on the phone, check:");
    console.log("  - notifications allowed for the app in system settings");
    console.log("  - iPhone: the app must be opened from the Home Screen, not Safari");
  }
  return report.sent > 0 ? 0 : 1;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
