import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "zustand"],
          terminal: [
            "@xterm/xterm",
            "@xterm/addon-fit",
            "@xterm/addon-search",
            "@xterm/addon-web-links",
            "@xterm/addon-webgl",
          ],
          tauri: ["@tauri-apps/api/core", "@tauri-apps/api/event"],
        },
      },
    },
  },
  server: {
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});
