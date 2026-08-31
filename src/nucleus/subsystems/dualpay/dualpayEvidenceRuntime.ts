// src/nucleus/subsystems/dualpay/dualpayEvidenceRuntime.ts

import { NucleusTelemetryAdapter } from "../../telemetry/nucleusTelemetryAdapter";

export class DualpayEvidenceRuntime {
  private telemetry: NucleusTelemetryAdapter;

  constructor(private organizationId: string) {
    this.telemetry = new NucleusTelemetryAdapter(
      organizationId,
      "dualpay-evidence"
    );
  }

  async run(payload: any) {
    const span = this.telemetry.startSpan("dualpay:evidence");

    try {
      const result = {
        claimId: payload.claimId,
        artifacts: [] as any[],
      };

      if (payload.denialOutcome) {
        result.artifacts.push({
          type: "denialOutcome",
          data: payload.denialOutcome,
        });
      }

      if (payload.cobOutcome) {
        result.artifacts.push({
          type: "cobOutcome",
          data: payload.cobOutcome,
        });
      }

      if (payload.adjudicationOutcome) {
        result.artifacts.push({
          type: "adjudicationOutcome",
          data: payload.adjudicationOutcome,
        });
      }

      await this.telemetry.info("DualPay evidence collected", result);
      return result;
    } catch (err) {
      await this.telemetry.error("DualPay evidence failed", { error: err });
      throw err;
    } finally {
      this.telemetry.endSpan(span.spanId);
    }
  }

  async health() {
    return {
      status: "healthy",
      runtime: "dualpay-evidence",
      timestamp: new Date().toISOString(),
    };
  }
}
