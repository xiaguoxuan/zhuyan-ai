import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The packaged app loads index.html through file://, so production assets
  // must remain relative to dist-renderer instead of pointing at /assets.
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
  },
});
