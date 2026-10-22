import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import PublicTopUpForm from "./features/top-ups/PublicTopUpForm";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<StrictMode><TooltipProvider><PublicTopUpForm /></TooltipProvider></StrictMode>);
