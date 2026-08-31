// src/nucleus/subsystems/dualpay/dualpayDenialClassifier.ts
// Classifies denial outcomes into severity + appealability

export function denialClassifier(outcome: any) {
  if (outcome.status === "approved") {
    return {
      severity: "none",
      appealable: false,
      category: "none",
    };
  }

  if (outcome.category === "administrative") {
    return {
      severity: "low",
      appealable: true,
      category: "administrative",
    };
  }

  if (outcome.category === "clinical") {
    return {
      severity: "high",
      appealable: true,
      category: "clinical",
    };
  }

  return {
    severity: "unknown",
    appealable: false,
    category: "unknown",
  };
}
