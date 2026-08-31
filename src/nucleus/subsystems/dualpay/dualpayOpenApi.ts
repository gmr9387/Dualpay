// src/nucleus/subsystems/dualpay/dualpayOpenApi.ts

export const DualpayOpenApi = {
  paths: {
    "/dualpay/run": {
      post: {
        summary: "Execute DualPay payment intelligence",
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
            description: "DualPay execution result",
          },
        },
      },
    },
    "/dualpay/health": {
      get: {
        summary: "DualPay subsystem health",
        responses: {
          200: {
            description: "Health status",
          },
        },
      },
    },
  },
};
