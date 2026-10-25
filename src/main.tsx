import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";

const Workspace = lazy(() => import("./App"));
const StatementWorkspace = lazy(() => import("./features/statements/StatementApp"));
const isStatementWorkspace = window.location.hostname === "statements.thatcanadian.dev" || /^\/statements(?:\/|$)/.test(window.location.pathname);
const CurrentWorkspace = isStatementWorkspace ? StatementWorkspace : Workspace;
if (isStatementWorkspace) document.title = "Statements · Finance";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Suspense fallback={<main className="loading-screen" role="status">Loading workspace…</main>}>
        <CurrentWorkspace />
      </Suspense>
    </TooltipProvider>
  </StrictMode>
);
