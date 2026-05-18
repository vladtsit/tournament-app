import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA is served under `/tournamentes/` on Azure Static Web Apps; the SWA root
// hosts a separate static placeholder. Build output layout (under `dist/`):
//
//   dist/
//     index.html              ← placeholder (copied by scripts/copy-placeholder.mjs)
//     tournamentes/
//       index.html            ← SPA entry
//       assets/...
//
// https://vitejs.dev/config/
export default defineConfig({
  base: "/tournamentes/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev convenience: hit Functions directly when running `npm run dev:app`.
      // When running via `npm run dev` (SWA CLI), this proxy is bypassed.
      "/api": "http://localhost:7071",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    outDir: "dist/tournamentes",
    emptyOutDir: true,
  },
});
