// src/nucleus/subsystems/dualpay/dualpayRecoveryRouter.ts

import { Router } from "express";
import { DualpayRecoveryController } from "./dualpayRecoveryController";

export function dualpayRecoveryRouter() {
  const router = Router();

  router.post("/recovery/run", async (req, res) => {
    const controller = new DualpayRecoveryController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.execute(req.body);
    res.json(result);
  });

  router.get("/recovery/health", async (req, res) => {
    const controller = new DualpayRecoveryController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.health();
    res.json(result);
  });

  return router;
}
