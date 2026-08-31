// src/nucleus/subsystems/dualpay/dualpayEvidenceController.ts

import { DualpayEvidenceRuntime } from "./dualpayEvidenceRuntime";

export class DualpayEvidenceController {
  constructor(private organizationId: string) {}

  async execute(payload: any) {
    const runtime = new DualpayEvidenceRuntime(this.organizationId);
    return runtime.run(payload);
  }

  async health() {
    const runtime = new DualpayEvidenceRuntime(this.organizationId);
    return runtime.health();
  }
}
