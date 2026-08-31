// src/nucleus/subsystems/dualpay/dualpayDenialController.ts

import { DualpayDenialRuntime } from "./dualpayDenialRuntime";

export class DualpayDenialController {
  constructor(private organizationId: string) {}

  async execute(payload: any) {
    const runtime = new DualpayDenialRuntime(this.organizationId);
    return runtime.run(payload);
  }

  async health() {
    const runtime = new DualpayDenialRuntime(this.organizationId);
    return runtime.health();
  }
}
