// src/nucleus/subsystems/dualpay/dualpayRecoveryController.ts

import { DualpayRecoveryRuntime } from "./dualpayRecoveryRuntime";

export class DualpayRecoveryController {
  constructor(private organizationId: string) {}

  async execute(payload: any) {
    const runtime = new DualpayRecoveryRuntime(this.organizationId);
    return runtime.run(payload);
  }

  async health() {
    const runtime = new DualpayRecoveryRuntime(this.organizationId);
    return runtime.health();
  }
}
