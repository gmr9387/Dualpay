// src/nucleus/subsystems/dualpay/dualpayLineageRuntime.ts

import { NucleusTelemetryAdapter } from "../../nucleusTracing";

export class DualpayLineageRuntime {
  private telemetry: NucleusTelemetryAdapter;

  constructor(private organizationId: string) {
    this.telemetry = new NucleusTelemetryAdapter(
      organizationId,
      "dualpay-lineage"
    );
  }

  async run(payload: any) {
    const span = this.telemetry.startSpan("dualpay:lineage");

    try {
      const result = {
        claimId: payload.claimId,
        lineage: [] as any[],
      };

      if (payload.adjudicationOutcome) {
        result.lineage.push({
          stage: "adjudication",
          outcome: payload.adjudicationOutcome,
        });
      }

      if (payload.cobOutcome) {
        result.lineage.push({
          stage: "cob",
          outcome: payload.cobOutcome,
        });
      }

      if (payload.denialOutcome) {
        result.lineage.push({
          stage: "denial",
          outcome: payload.denialOutcome,
        });
      }

      if (payload.recoveryOutcome) {
        result.lineage.push({
          stage: "recovery",
          outcome: payload.recoveryOutcome,
        });
      }

      if (payload.paymentDecision) {
        result.lineage.push({
          stage: "payment",
          outcome: payload.paymentDecision,
        });
      }

      await this.telemetry.info("DualPay lineage built", result);
      return result;
    } catch (err) {
      await this.telemetry.error("DualPay lineage failed", { error: err });
      throw err;
    } finally {
      this.telemetry.endSpan(span.spanId);
    }
  }

  async health() {
    return {
      status: "healthy",
      runtime: "dualpay-lineage",
      timestamp: new Date().toISOString(),
    };
  }
}
