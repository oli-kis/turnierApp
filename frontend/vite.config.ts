import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_URL = process.env.VITE_API_URL ?? "http://localhost:3000";

export default defineConfig({
  // Cast avoids a spurious type clash from vitest bundling its own vite copy.
  plugins: [react(), tailwindcss()] as never,
  server: {
    port: 5173,
    proxy: {
      // Backend API and SSE stream both live under /api.
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
