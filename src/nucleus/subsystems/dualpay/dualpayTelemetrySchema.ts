// src/nucleus/subsystems/dualpay/dualpayTelemetrySchema.ts

export const DualpayTelemetrySchema = {
  eventTypes: [
    "dualpay.start",
    "dualpay.step",
    "dualpay.complete",
    "dualpay.error",
  ],

  metrics: {
    adjudicationTimeMs: {
      type: "number",
      description: "Time spent in adjudication logic",
    },
    cobTimeMs: {
      type: "number",
      description: "Time spent in COB logic",
    },
    paymentTimeMs: {
      type: "number",
      description: "Time spent determining payment",
    },
  },
};
