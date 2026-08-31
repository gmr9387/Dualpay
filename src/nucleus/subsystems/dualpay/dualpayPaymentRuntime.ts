// src/nucleus/subsystems/dualpay/dualpayPaymentRuntime.ts

import { NucleusTelemetryAdapter } from "../../nucleusTracing";

export class DualpayPaymentRuntime {
  private telemetry: NucleusTelemetryAdapter;

  constructor(private organizationId: string) {
    this.telemetry = new NucleusTelemetryAdapter(
      organizationId,
      "dualpay-payment"
    );
  }

  async run(payload: any) {
    const span = this.telemetry.startSpan("dualpay:payment");

    try {
      const result = {
        claimId: payload.claimId,
        adjudicationOutcome: payload.adjudicationOutcome,
        cobOutcome: payload.cobOutcome,
        denialOutcome: payload.denialOutcome,
        paymentDecision: null as any,
      };

      if (payload.denialOutcome?.status === "denied") {
        result.paymentDecision = {
          status: "no-pay",
          reason: payload.denialOutcome.reason,
          amount: 0,
        };
      } else if (payload.cobOutcome?.status === "secondary") {
        result.paymentDecision = {
          status: "partial-pay",
          reason: "Secondary payer responsibility",
          amount: (payload.allowedAmount || 0) * 0.5,
        };
      } else {
        result.paymentDecision = {
          status: "pay",
          reason: "Approved claim",
          amount: payload.allowedAmount || payload.billedAmount || 0,
        };
      }

      await this.telemetry.info("DualPay payment completed", result);
      return result;
    } catch (err) {
      await this.telemetry.error("DualPay payment failed", { error: err });
      throw err;
    } finally {
      this.telemetry.endSpan(span.spanId);
    }
  }

  async health() {
    return {
      status: "healthy",
      runtime: "dualpay-payment",
      timestamp: new Date().toISOString(),
    };
  }
}
