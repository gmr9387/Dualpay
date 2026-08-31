// src/nucleus/subsystems/dualpay/dualpayLineageController.ts

import { DualpayLineageRuntime } from "./dualpayLineageRuntime";

export class DualpayLineageController {
  constructor(private organizationId: string) {}

  async execute(payload: any) {
    const runtime = new DualpayLineageRuntime(this.organizationId);
    return runtime.run(payload);
  }

  async health() {
    const runtime = new DualpayLineageRuntime(this.organizationId);
    return runtime.health();
  }
}
