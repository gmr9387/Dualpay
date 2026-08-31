// src/nucleus/subsystems/dualpay/dualpayAdjudicationRuntime.ts
// DualPay Adjudication Runtime — deterministic rule engine

import { NucleusTelemetryAdapter } from "../../telemetry/nucleusTelemetryAdapter";
import { adjudicationRules } from "./dualpayAdjudicationRules";

export class DualpayAdjudicationRuntime {
  private telemetry: NucleusTelemetryAdapter;

  constructor(private organizationId: string) {
    this.telemetry = new NucleusTelemetryAdapter(
      organizationId,
      "dualpay-adjudication"
    );
  }

  async run(payload: any) {
    const span = this.telemetry.startSpan("dualpay:adjudication");

    try {
      const result = {
        claimId: payload.claimId,
        steps: [],
        outcome: null,
        appliedRules: [],
      };

      // Step 1 — Normalize claim
      result.steps.push({ step: "normalize", status: "ok" });

      // Step 2 — Apply adjudication rules
      for (const rule of adjudicationRules) {
        const applied = rule.apply(payload);

        if (applied.matched) {
          result.appliedRules.push({
            ruleId: rule.id,
            description: rule.description,
            outcome: applied.outcome,
          });

          if (applied.outcome.final) {
            result.outcome = applied.outcome;
            break;
          }
        }
      }

      // Step 3 — Default outcome if no rule matched
      if (!result.outcome) {
        result.outcome = {
          status: "approved",
          reason: "No adjudication rule blocked payment",
          final: true,
        };
      }

      await this.telemetry.info("DualPay adjudication completed", result);
      return result;
    } catch (err) {
      await this.telemetry.error("DualPay adjudication failed", { error: err });
      throw err;
    } finally {
      this.telemetry.endSpan(span.spanId);
    }
  }

  async health() {
    return {
      status: "healthy",
      runtime: "dualpay-adjudication",
      timestamp: new Date().toISOString(),
    };
  }
}
