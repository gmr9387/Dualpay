// src/nucleus/subsystems/dualpay/dualpayController.ts

import { DualpayRuntime } from "./dualpayRuntime";

export class DualpayController {
  constructor(private organizationId: string) {}

  async execute(payload: any) {
    const runtime = new DualpayRuntime(this.organizationId);
    return runtime.run(payload);
  }

  async health() {
    const runtime = new DualpayRuntime(this.organizationId);
    return runtime.health();
  }
}
