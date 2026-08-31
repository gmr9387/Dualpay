// src/nucleus/subsystems/dualpay/dualpayPaymentController.ts

import { DualpayPaymentRuntime } from "./dualpayPaymentRuntime";

export class DualpayPaymentController {
  constructor(private organizationId: string) {}

  async execute(payload: any) {
    const runtime = new DualpayPaymentRuntime(this.organizationId);
    return runtime.run(payload);
  }

  async health() {
    const runtime = new DualpayPaymentRuntime(this.organizationId);
    return runtime.health();
  }
}
