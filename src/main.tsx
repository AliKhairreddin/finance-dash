import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";

const Workspace = lazy(() => import("./App"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Suspense fallback={<main className="loading-screen" role="status">Loading workspace…</main>}>
        <Workspace />
      </Suspense>
    </TooltipProvider>
  </StrictMode>
);
