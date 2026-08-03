import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";

const isSlashWorkspace = window.location.hostname === "slash.thatcanadian.dev"
  || window.location.hostname === "slash.localhost";
const Workspace = lazy(() => isSlashWorkspace ? import("./SlashApp") : import("./App"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Suspense fallback={<main className="loading-screen" role="status">Loading workspace…</main>}>
        <Workspace />
      </Suspense>
    </TooltipProvider>
  </StrictMode>
);
