// src/nucleus/subsystems/dualpay/dualpayPaymentOpenApi.ts

export const DualpayPaymentOpenApi = {
  paths: {
    "/dualpay/payment/run": {
      post: {
        summary: "Execute DualPay payment engine",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { type: "object" } }
          }
        },
        responses: {
          200: { description: "Payment decision result" }
        }
      }
    },
    "/dualpay/payment/health": {
      get: {
        summary: "DualPay payment health",
        responses: {
          200: { description: "Health status" }
        }
      }
    }
  }
};
