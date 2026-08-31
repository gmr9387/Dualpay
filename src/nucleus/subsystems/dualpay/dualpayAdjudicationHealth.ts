// src/nucleus/subsystems/dualpay/dualpayAdjudicationHealth.ts

import { DualpayAdjudicationRuntime } from "./dualpayAdjudicationRuntime";

export class DualpayAdjudicationHealth {
  constructor(private organizationId: string) {}

  async check() {
    const runtime = new DualpayAdjudicationRuntime(this.organizationId);
    return runtime.health();
  }
}
