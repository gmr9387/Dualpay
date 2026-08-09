import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializeIdempotencyKeyTracking } from "@/engine/state-machine";

// Initialize persistent idempotency tracking on startup so that keys consumed
// in prior sessions are recognized and duplicate payment actions are blocked.
initializeIdempotencyKeyTracking().catch((err) =>
  console.error("[startup] idempotency init failed:", err)
);

createRoot(document.getElementById("root")!).render(<App />);
