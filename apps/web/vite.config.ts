import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/server/data/**"] },
    port: 4611,
    strictPort: true,
    host: true,
    proxy: { "/api": "http://localhost:4610" },
  },
  preview: { port: 4611, strictPort: true, host: true, proxy: { "/api": "http://localhost:4610" } },
});
