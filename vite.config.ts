import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), { name: "workspace-routes", configureServer(server) { server.middlewares.use((req, _res, next) => { if (/^\/(top-up|payments)\/?(?:\?|$)/.test(req.url ?? "")) req.url = "/top-up.html"; else if (/^\/statements(?:\/|\?|$)/.test(req.url ?? "")) req.url = "/statements.html"; next(); }); } }],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  build: { rollupOptions: { input: { main: path.resolve(__dirname, "index.html"), statements: path.resolve(__dirname, "statements.html"), receiptCapture: path.resolve(__dirname, "receipt-capture.html") } } },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
