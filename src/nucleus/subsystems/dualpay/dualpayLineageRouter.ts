// src/nucleus/subsystems/dualpay/dualpayLineageRouter.ts

import { Router } from "express";
import { DualpayLineageController } from "./dualpayLineageController";

export function dualpayLineageRouter() {
  const router = Router();

  router.post("/lineage/run", async (req, res) => {
    const controller = new DualpayLineageController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.execute(req.body);
    res.json(result);
  });

  router.get("/lineage/health", async (req, res) => {
    const controller = new DualpayLineageController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.health();
    res.json(result);
  });

  return router;
}
