// src/nucleus/subsystems/dualpay/dualpayAdjudicationRules.ts
// Adjudication Rules — deterministic rule set

export const adjudicationRules = [
  {
    id: "RULE-001",
    description: "Deny claim if member coverage is inactive",
    apply(payload: any) {
      if (payload.member?.coverageStatus === "inactive") {
        return {
          matched: true,
          outcome: {
            status: "denied",
            reason: "Inactive coverage",
            final: true,
          },
        };
      }
      return { matched: false };
    },
  },

  {
    id: "RULE-002",
    description: "Flag claim for manual review if billed amount exceeds threshold",
    apply(payload: any) {
      if (payload.billedAmount > 50000) {
        return {
          matched: true,
          outcome: {
            status: "review",
            reason: "High-cost claim",
            final: false,
          },
        };
      }
      return { matched: false };
    },
  },

  {
    id: "RULE-003",
    description: "Deny claim if procedure code is excluded",
    apply(payload: any) {
      const excluded = ["99999", "00000"];
      if (excluded.includes(payload.procedureCode)) {
        return {
          matched: true,
          outcome: {
            status: "denied",
            reason: "Excluded procedure code",
            final: true,
          },
        };
      }
      return { matched: false };
    },
  },
];
