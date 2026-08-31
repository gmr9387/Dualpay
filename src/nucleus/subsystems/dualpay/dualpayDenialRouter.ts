// src/nucleus/subsystems/dualpay/dualpayDenialRouter.ts

import { Router } from "express";
import { DualpayDenialController } from "./dualpayDenialController";

export function dualpayDenialRouter() {
  const router = Router();

  router.post("/denial/run", async (req, res) => {
    const controller = new DualpayDenialController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.execute(req.body);
    res.json(result);
  });

  router.get("/denial/health", async (req, res) => {
    const controller = new DualpayDenialController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.health();
    res.json(result);
  });

  return router;
}
