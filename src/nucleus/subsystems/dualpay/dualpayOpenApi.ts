// src/nucleus/subsystems/dualpay/dualpayOpenApi.ts

import { DualpayAdjudicationOpenApi } from "./dualpayAdjudicationOpenApi";
import { DualpayCobOpenApi } from "./dualpayCobOpenApi";

export const DualpayOpenApi = {
  paths: {
    // Phase 1
    "/dualpay/run": {
      post: {
        summary: "Execute DualPay payment intelligence",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { type: "object" } }
          }
        },
        responses: { 200: { description: "DualPay execution result" } }
      }
    },

    "/dualpay/health": {
      get: {
        summary: "DualPay subsystem health",
        responses: { 200: { description: "Health status" } }
      }
    },

    // Phase 2
    ...DualpayAdjudicationOpenApi.paths,

    // Phase 3
    ...DualpayCobOpenApi.paths,

    // Phase 4
    "/dualpay/denial/run": {
      post: {
        summary: "Execute DualPay denial intelligence",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { type: "object" } }
          }
        },
        responses: { 200: { description: "Denial intelligence result" } }
      }
    },

    "/dualpay/denial/health": {
      get: {
        summary: "DualPay denial health",
        responses: { 200: { description: "Health status" } }
      }
    },

    // Phase 5 — Recovery
    "/dualpay/recovery/run": {
      post: {
        summary: "Execute DualPay recovery engine",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { type: "object" } }
          }
        },
        responses: { 200: { description: "Recovery result" } }
      }
    },

    "/dualpay/recovery/health": {
      get: {
        summary: "DualPay recovery health",
        responses: { 200: { description: "Health status" } }
      }
    },

    // Phase 5 — Evidence
    "/dualpay/evidence/run": {
      post: {
        summary: "Execute DualPay evidence engine",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { type: "object" } }
          }
        },
        responses: { 200: { description: "Evidence collection result" } }
      }
    },

    "/dualpay/evidence/health": {
      get: {
        summary: "DualPay evidence health",
        responses: { 200: { description: "Health status" } }
      }
    }
  }
};
