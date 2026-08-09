import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializeIdempotencyKeyTracking } from "@/engine/state-machine";

// Warm the in-memory idempotency cache from persistent storage so that keys
// consumed in prior sessions are recognized before the first payment action.
//
// Failure is intentionally non-blocking: the app can still start safely
// because `isIdempotencyKeyConsumedPersistent` falls back to a direct DB
// check on every call when the cache is cold — duplicate-payment protection
// remains intact even if the warm-up fails.
initializeIdempotencyKeyTracking().catch((err) => {
  console.error(
    "[startup] Idempotency key tracking initialization failed — " +
    "the app will fall back to per-call DB checks. " +
    "Investigate connectivity issues before processing payment actions.",
    err
  );
});

createRoot(document.getElementById("root")!).render(<App />);
