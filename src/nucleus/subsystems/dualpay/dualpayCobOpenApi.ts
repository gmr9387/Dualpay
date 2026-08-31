// src/nucleus/subsystems/dualpay/dualpayCobOpenApi.ts

export const DualpayCobOpenApi = {
  paths: {
    "/dualpay/cob/run": {
      post: {
        summary: "Execute DualPay COB engine",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object" },
            },
          },
        },
        responses: {
          200: {
            description: "COB result",
          },
        },
      },
    },
    "/dualpay/cob/health": {
      get: {
        summary: "DualPay COB health",
        responses: {
          200: {
            description: "Health status",
          },
        },
      },
    },
  },
};
