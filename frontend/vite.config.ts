import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const API_URL = process.env.VITE_API_URL ?? "http://localhost:3000";

export default defineConfig({
  // Cast avoids a spurious type clash from vitest bundling its own vite copy.
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // injectManifest, not the default generateSW: referee push needs real
      // `push` / `notificationclick` listeners, which a generated worker cannot
      // express. src/sw.ts restates the caching contract explicitly.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "FC Frick Turnier",
        short_name: "FC Frick",
        description: "Spielplan, Resultate und Tabellen des FC Frick Turniers",
        lang: "de-CH",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#F6F6F2", // --color-chalk
        theme_color: "#1A5A48", // --color-pine
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      // What gets precached. The routing, the /api rule and the update
      // behaviour now live in src/sw.ts, which is the worker itself.
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
      },
      devOptions: {
        // Keep the SW out of `npm run dev`; it caches the shell and makes HMR lie.
        enabled: false,
      },
    }),
  ] as never,
  server: {
    port: 5173,
    // So the dev server can be reached through a tunnel when testing on a real
    // phone — Vite 6 refuses unknown Host headers („Blocked request") otherwise.
    // Note the SW is off in dev, so a tunnelled dev server still cannot exercise
    // push or install; use `preview` for those (see the PWA notes in CLAUDE.md).
    allowedHosts: true,
    proxy: {
      // Backend API and SSE stream both live under /api. The proxy runs on the
      // laptop, so a phone only ever talks to this port — the API port never has
      // to be reachable from the network.
      "/api": {
        target: API_URL,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    // Testing push on a real phone needs a secure context, which means tunnelling
    // preview through an HTTPS host (see the PWA notes in CLAUDE.md). Vite 6
    // rejects unknown Host headers, so a tunnel domain would be refused with
    // "Blocked request" before the app ever loads. Preview is a local testing
    // server that is never exposed deliberately, so allowing any host here costs
    // nothing and removes a confusing dead end.
    allowedHosts: true,
    // Same proxy as dev: the service worker only ships in a real build, so the
    // PWA can only be exercised against `preview`, and it needs the API too —
    // one origin for app and API means no CORS and no mixed content.
    proxy: {
      "/api": {
        target: API_URL,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
