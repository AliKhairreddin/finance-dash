import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), { name: "public-top-up-route", configureServer(server) { server.middlewares.use((req, _res, next) => { if (/^\/(top-up|payments)\/?(?:\?|$)/.test(req.url ?? "")) req.url = "/top-up.html"; next(); }); } }],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
