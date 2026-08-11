import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializeIdempotencyKeyTracking } from "@/engine/state-machine";

// Warm the in-memory idempotency cache for the current browser session.
//
// This is a UI-layer hint only — the authoritative idempotency gate is the
// Phase 4B SECURITY DEFINER RPCs (rpc_advance_payment_state,
// rpc_log_recovery_event, rpc_log_write_off, rpc_advance_appeal_case).
//
// Failure is intentionally non-blocking: the RPCs enforce uniqueness at the
// PostgreSQL layer regardless of whether the UI cache is warm.
initializeIdempotencyKeyTracking().catch((err) => {
  console.error(
    "[startup] Idempotency key tracking initialization failed — " +
    "the app will start with a cold UI cache. " +
    "Financial mutations remain safe; the Phase 4B RPCs enforce uniqueness at the DB layer.",
    err
  );
});

createRoot(document.getElementById("root")!).render(<App />);
