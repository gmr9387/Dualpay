// src/nucleus/subsystems/dualpay/dualpayCobRouter.ts

import { Router } from "express";
import { DualpayCobController } from "./dualpayCobController";

export function dualpayCobRouter() {
  const router = Router();

  router.post("/cob/run", async (req, res) => {
    const controller = new DualpayCobController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.execute(req.body);
    res.json(result);
  });

  router.get("/cob/health", async (req, res) => {
    const controller = new DualpayCobController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.health();
    res.json(result);
  });

  return router;
}
