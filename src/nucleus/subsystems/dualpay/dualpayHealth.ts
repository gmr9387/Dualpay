// src/nucleus/subsystems/dualpay/dualpayHealth.ts

import { DualpayRuntime } from "./dualpayRuntime";

export class DualpayHealth {
  constructor(private organizationId: string) {}

  async check() {
    const runtime = new DualpayRuntime(this.organizationId);
    return runtime.health();
  }
}
