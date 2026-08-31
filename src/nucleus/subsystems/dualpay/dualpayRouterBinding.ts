// src/nucleus/subsystems/dualpay/dualpayRouterBinding.ts

import { dualpayRouter } from "./dualpayRouter";
import { dualpayAdjudicationRouter } from "./dualpayAdjudicationRouter";
import { dualpayCobRouter } from "./dualpayCobRouter";
import { dualpayDenialRouter } from "./dualpayDenialRouter";
import { dualpayRecoveryRouter } from "./dualpayRecoveryRouter";
import { dualpayEvidenceRouter } from "./dualpayEvidenceRouter";

export function bindDualpayRoutes(app: any) {
  app.use("/dualpay", dualpayRouter());
  app.use("/dualpay", dualpayAdjudicationRouter());
  app.use("/dualpay", dualpayCobRouter());
  app.use("/dualpay", dualpayDenialRouter());
  app.use("/dualpay", dualpayRecoveryRouter());
  app.use("/dualpay", dualpayEvidenceRouter());
}
