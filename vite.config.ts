import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          const modulePath = id.split("node_modules/")[1];
          if (!modulePath) {
            return;
          }

          const segments = modulePath.split("/");
          const packageName = segments[0]?.startsWith("@")
            ? `${segments[0]}/${segments[1]}`
            : segments[0];

          if (!packageName) {
            return;
          }

          if (packageName.startsWith("@tauri-apps/")) {
            return "tauri";
          }

          if (packageName === "@tanstack/react-query") {
            return "react-query";
          }

          if (packageName.startsWith("@radix-ui/")) {
            return "radix";
          }

          if (packageName.startsWith("@floating-ui/")) {
            return "radix";
          }

          if (packageName === "react-hook-form" || packageName === "@hookform/resolvers" || packageName === "zod") {
            return "forms";
          }

          if (packageName === "react" || packageName === "react-dom" || packageName === "scheduler") {
            return "react-core";
          }

          if (
            packageName === "aria-hidden" ||
            packageName === "class-variance-authority" ||
            packageName === "clsx" ||
            packageName === "detect-node-es" ||
            packageName === "framer-motion" ||
            packageName === "get-nonce" ||
            packageName === "lucide-react" ||
            packageName === "motion" ||
            packageName === "motion-dom" ||
            packageName === "motion-utils" ||
            packageName === "react-remove-scroll" ||
            packageName === "react-remove-scroll-bar" ||
            packageName === "react-style-singleton" ||
            packageName === "tailwind-merge"
            || packageName === "tslib"
            || packageName === "use-callback-ref"
            || packageName === "use-sidecar"
          ) {
            return "ui-utils";
          }

          return packageName.replace("@", "").replace("/", "-");
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 6810,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 6811,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
