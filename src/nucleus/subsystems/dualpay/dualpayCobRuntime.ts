// src/nucleus/subsystems/dualpay/dualpayCobRuntime.ts
// DualPay COB Runtime — determines payer hierarchy & benefit allocation

import { NucleusTelemetryAdapter } from "../../telemetry/nucleusTelemetryAdapter";
import { cobRules } from "./dualpayCobRules";

export class DualpayCobRuntime {
  private telemetry: NucleusTelemetryAdapter;

  constructor(private organizationId: string) {
    this.telemetry = new NucleusTelemetryAdapter(
      organizationId,
      "dualpay-cob"
    );
  }

  async run(payload: any) {
    const span = this.telemetry.startSpan("dualpay:cob");

    try {
      const result = {
        claimId: payload.claimId,
        steps: [],
        appliedRules: [],
        cobOutcome: null,
      };

      // Step 1 — Normalize COB data
      result.steps.push({ step: "normalize", status: "ok" });

      // Step 2 — Apply COB rules
      for (const rule of cobRules) {
        const applied = rule.apply(payload);

        if (applied.matched) {
          result.appliedRules.push({
            ruleId: rule.id,
            description: rule.description,
            outcome: applied.outcome,
          });

          if (applied.outcome.final) {
            result.cobOutcome = applied.outcome;
            break;
          }
        }
      }

      // Step 3 — Default COB outcome
      if (!result.cobOutcome) {
        result.cobOutcome = {
          status: "primary",
          reason: "No COB rule changed payer responsibility",
          final: true,
        };
      }

      await this.telemetry.info("DualPay COB completed", result);
      return result;
    } catch (err) {
      await this.telemetry.error("DualPay COB failed", { error: err });
      throw err;
    } finally {
      this.telemetry.endSpan(span.spanId);
    }
  }

  async health() {
    return {
      status: "healthy",
      runtime: "dualpay-cob",
      timestamp: new Date().toISOString(),
    };
  }
}
