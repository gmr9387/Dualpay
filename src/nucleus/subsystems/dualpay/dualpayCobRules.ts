// src/nucleus/subsystems/dualpay/dualpayCobRules.ts
// COB Rules — determines payer hierarchy & coordination logic

export const cobRules = [
  {
    id: "COB-001",
    description: "Medicare is always primary when member is 65+ unless ESRD rules apply",
    apply(payload: any) {
      if (payload.member?.age >= 65 && payload.member?.medicareEligible) {
        return {
          matched: true,
          outcome: {
            status: "primary",
            reason: "Medicare primary due to age eligibility",
            final: true,
          },
        };
      }
      return { matched: false };
    },
  },

  {
    id: "COB-002",
    description: "Employer group plan is primary when member is actively employed",
    apply(payload: any) {
      if (payload.member?.employmentStatus === "active") {
        return {
          matched: true,
          outcome: {
            status: "primary",
            reason: "Employer group plan primary due to active employment",
            final: true,
          },
        };
      }
      return { matched: false };
    },
  },

  {
    id: "COB-003",
    description: "Auto insurance is primary for accident-related claims",
    apply(payload: any) {
      if (payload.accident?.type === "auto") {
        return {
          matched: true,
          outcome: {
            status: "secondary",
            reason: "Auto insurance primary for accident claims",
            final: true,
          },
        };
      }
      return { matched: false };
    },
  },

  {
    id: "COB-004",
    description: "Workers compensation primary for workplace injuries",
    apply(payload: any) {
      if (payload.accident?.type === "workplace") {
        return {
          matched: true,
          outcome: {
            status: "secondary",
            reason: "Workers compensation primary for workplace injuries",
            final: true,
          },
        };
      }
      return { matched: false };
    },
  },
];
