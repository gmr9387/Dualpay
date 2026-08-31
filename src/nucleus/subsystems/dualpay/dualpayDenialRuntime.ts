// src/nucleus/subsystems/dualpay/dualpayDenialRuntime.ts
// DualPay Denial Intelligence Runtime — classifies and determines denial outcomes

import { NucleusTelemetryAdapter } from "../../telemetry/nucleusTelemetryAdapter";
import { denialRules } from "./dualpayDenialRules";
import { denialClassifier } from "./dualpayDenialClassifier";

export class DualpayDenialRuntime {
  private telemetry: NucleusTelemetryAdapter;

  constructor(private organizationId: string) {
    this.telemetry = new NucleusTelemetryAdapter(
      organizationId,
      "dualpay-denial"
    );
  }

  async run(payload: any) {
    const span = this.telemetry.startSpan("dualpay:denial");

    try {
      const result = {
        claimId: payload.claimId,
        steps: [],
        appliedRules: [],
        denialOutcome: null,
        classification: null,
      };

      // Step 1 — Normalize claim
      result.steps.push({ step: "normalize", status: "ok" });

      // Step 2 — Apply denial rules
      for (const rule of denialRules) {
        const applied = rule.apply(payload);

        if (applied.matched) {
          result.appliedRules.push({
            ruleId: rule.id,
            description: rule.description,
            outcome: applied.outcome,
          });

          if (applied.outcome.final) {
            result.denialOutcome = applied.outcome;
            break;
          }
        }
      }

      // Step 3 — Default denial outcome
      if (!result.denialOutcome) {
        result.denialOutcome = {
          status: "approved",
          reason: "No denial rule triggered",
          final: true,
        };
      }

      // Step 4 — Classification
      result.classification = denialClassifier(result.denialOutcome);

      await this.telemetry.info("DualPay denial completed", result);
      return result;
    } catch (err) {
      await this.telemetry.error("DualPay denial failed", { error: err });
      throw err;
    } finally {
      this.telemetry.endSpan(span.spanId);
    }
  }

  async health() {
    return {
      status: "healthy",
      runtime: "dualpay-denial",
      timestamp: new Date().toISOString(),
    };
  }
}
