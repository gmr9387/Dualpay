// src/nucleus/subsystems/dualpay/dualpayRecoveryRuntime.ts

import { NucleusTelemetryAdapter } from "../../telemetry/nucleusTelemetryAdapter";

export class DualpayRecoveryRuntime {
  private telemetry: NucleusTelemetryAdapter;

  constructor(private organizationId: string) {
    this.telemetry = new NucleusTelemetryAdapter(
      organizationId,
      "dualpay-recovery"
    );
  }

  async run(payload: any) {
    const span = this.telemetry.startSpan("dualpay:recovery");

    try {
      const result = {
        claimId: payload.claimId,
        potentialRecovery: null,
        reasons: [] as string[],
      };

      if (payload.denialOutcome?.status === "denied") {
        result.potentialRecovery = {
          eligible: true,
          type: "appeal",
          estimatedValue: payload.billedAmount || 0,
        };
        result.reasons.push("Denied claim eligible for appeal-based recovery");
      } else if (payload.cobOutcome?.status === "secondary") {
        result.potentialRecovery = {
          eligible: true,
          type: "COB",
          estimatedValue: payload.billedAmount || 0,
        };
        result.reasons.push("COB misalignment may yield recovery");
      } else {
        result.potentialRecovery = {
          eligible: false,
          type: "none",
          estimatedValue: 0,
        };
        result.reasons.push("No clear recovery opportunity detected");
      }

      await this.telemetry.info("DualPay recovery completed", result);
      return result;
    } catch (err) {
      await this.telemetry.error("DualPay recovery failed", { error: err });
      throw err;
    } finally {
      this.telemetry.endSpan(span.spanId);
    }
  }

  async health() {
    return {
      status: "healthy",
      runtime: "dualpay-recovery",
      timestamp: new Date().toISOString(),
    };
  }
}
