// src/nucleus/subsystems/dualpay/dualpayAdjudicationOpenApi.ts

export const DualpayAdjudicationOpenApi = {
  paths: {
    "/dualpay/adjudication/run": {
      post: {
        summary: "Execute DualPay adjudication engine",
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
            description: "Adjudication result",
          },
        },
      },
    },
    "/dualpay/adjudication/health": {
      get: {
        summary: "DualPay adjudication health",
        responses: {
          200: {
            description: "Health status",
          },
        },
      },
    },
  },
};
