// src/nucleus/subsystems/dualpay/dualpayDenialRules.ts
// Denial Rules — deterministic denial logic

export const denialRules = [
  {
    id: "DENIAL-001",
    description: "Deny claim if provider is out-of-network",
    apply(payload: any) {
      if (payload.provider?.networkStatus === "out-of-network") {
        return {
          matched: true,
          outcome: {
            status: "denied",
            reason: "Provider out-of-network",
            category: "administrative",
            final: true,
          },
        };
      }
      return { matched: false };
    },
  },

  {
    id: "DENIAL-002",
    description: "Deny claim if prior authorization required but missing",
    apply(payload: any) {
      if (payload.requiresAuth && !payload.authNumber) {
        return {
          matched: true,
          outcome: {
            status: "denied",
            reason: "Missing prior authorization",
            category: "administrative",
            final: true,
          },
        };
      }
      return { matched: false };
    },
  },

  {
    id: "DENIAL-003",
    description: "Flag claim for clinical review if diagnosis conflicts with procedure",
    apply(payload: any) {
      const conflict = payload.diagnosisCode?.startsWith("Z") &&
                       payload.procedureCode?.startsWith("3");

      if (conflict) {
        return {
          matched: true,
          outcome: {
            status: "review",
            reason: "Diagnosis/procedure conflict",
            category: "clinical",
            final: false,
          },
        };
      }
      return { matched: false };
    },
  },
];
