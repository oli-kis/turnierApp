import webpush from "web-push";

/**
 * Print a fresh VAPID keypair for pasting into `.env`.
 *
 * Not written to a file on purpose: the private key is a credential, and the one
 * place it must never end up is a repo. Rotating it silently unsubscribes every
 * referee (their stored subscriptions are bound to the old public key), so
 * generate once per deployment and keep it.
 */
const { publicKey, privateKey } = webpush.generateVAPIDKeys();

process.stdout.write(
  [
    "# Web Push keys — paste into .env, keep the private key secret.",
    "# Rotating these invalidates every existing referee subscription.",
    `VAPID_PUBLIC_KEY=${publicKey}`,
    `VAPID_PRIVATE_KEY=${privateKey}`,
    "VAPID_SUBJECT=mailto:admin@fcfrick.ch",
    "",
  ].join("\n"),
);
