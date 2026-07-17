/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the backend API, baked in at build time.
   *
   * Distinct from `VITE_API_URL`, which is the *dev/preview proxy target* read
   * by `vite.config.ts` and never reaches the bundle. Two variables because they
   * answer different questions: "where does the Vite server forward `/api`?" and
   * "who does the shipped app talk to?".
   *
   * Unset (dev, preview, tests) → same-origin `/api` through the proxy, which is
   * what lets a phone on the LAN or a tunnel reach the API without the API port
   * being exposed at all. Set only for a static deployment where no proxy exists.
   */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
