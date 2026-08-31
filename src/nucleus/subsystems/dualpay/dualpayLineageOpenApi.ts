// src/nucleus/subsystems/dualpay/dualpayLineageOpenApi.ts

export const DualpayLineageOpenApi = {
  paths: {
    "/dualpay/lineage/run": {
      post: {
        summary: "Execute DualPay lineage engine",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { type: "object" } }
          }
        },
        responses: {
          200: { description: "Lineage result" }
        }
      }
    },
    "/dualpay/lineage/health": {
      get: {
        summary: "DualPay lineage health",
        responses: {
          200: { description: "Health status" }
        }
      }
    }
  }
};
