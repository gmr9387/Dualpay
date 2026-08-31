// src/nucleus/subsystems/dualpay/dualpayOpenApi.ts

import { DualpayAdjudicationOpenApi } from "./dualpayAdjudicationOpenApi";
import { DualpayCobOpenApi } from "./dualpayCobOpenApi";
import { DualpayDenialOpenApi } from "./dualpayDenialOpenApi";
import { DualpayRecoveryOpenApi } from "./dualpayRecoveryOpenApi";
import { DualpayEvidenceOpenApi } from "./dualpayEvidenceOpenApi";
import { DualpayPaymentOpenApi } from "./dualpayPaymentOpenApi";
import { DualpayLineageOpenApi } from "./dualpayLineageOpenApi";

export const DualpayOpenApi = {
  paths: {
    ...DualpayAdjudicationOpenApi.paths,
    ...DualpayCobOpenApi.paths,
    ...DualpayDenialOpenApi.paths,
    ...DualpayRecoveryOpenApi.paths,
    ...DualpayEvidenceOpenApi.paths,
    ...DualpayPaymentOpenApi.paths,
    ...DualpayLineageOpenApi.paths,
  }
};
