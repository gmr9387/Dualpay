// src/nucleus/subsystems/dualpay/dualpayRouter.ts

import { Router } from "express";
import { DualpayController } from "./dualpayController";

export function dualpayRouter() {
  const router = Router();

  router.post("/run", async (req, res) => {
    const controller = new DualpayController(req.headers["x-org-id"] as string);
    const result = await controller.execute(req.body);
    res.json(result);
  });

  router.get("/health", async (req, res) => {
    const controller = new DualpayController(req.headers["x-org-id"] as string);
    const result = await controller.health();
    res.json(result);
  });

  return router;
}
