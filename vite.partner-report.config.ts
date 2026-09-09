import path from "node:path";
import { defineConfig } from "vite";

// A self-contained renderer is sent to Browser Run with a frozen data snapshot.
// Library mode inlines font assets, so reports need no authenticated network requests.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/features/partner-updates/renderReport.ts"),
      name: "PartnerReport",
      formats: ["iife"],
      fileName: () => "partner-report.js",
      cssFileName: "partner-report"
    }
  }
});
