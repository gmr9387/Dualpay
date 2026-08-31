// src/nucleus/subsystems/dualpay/dualpayAdjudicationRouter.ts

import { Router } from "express";
import { DualpayAdjudicationController } from "./dualpayAdjudicationController";

export function dualpayAdjudicationRouter() {
  const router = Router();

  router.post("/adjudication/run", async (req, res) => {
    const controller = new DualpayAdjudicationController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.execute(req.body);
    res.json(result);
  });

  router.get("/adjudication/health", async (req, res) => {
    const controller = new DualpayAdjudicationController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.health();
    res.json(result);
  });

  return router;
}
