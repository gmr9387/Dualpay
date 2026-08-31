// src/nucleus/subsystems/dualpay/dualpayAdjudicationController.ts

import { DualpayAdjudicationRuntime } from "./dualpayAdjudicationRuntime";

export class DualpayAdjudicationController {
  constructor(private organizationId: string) {}

  async execute(payload: any) {
    const runtime = new DualpayAdjudicationRuntime(this.organizationId);
    return runtime.run(payload);
  }

  async health() {
    const runtime = new DualpayAdjudicationRuntime(this.organizationId);
    return runtime.health();
  }
}
