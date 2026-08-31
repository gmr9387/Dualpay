// src/nucleus/subsystems/dualpay/dualpayEvidenceRouter.ts

import { Router } from "express";
import { DualpayEvidenceController } from "./dualpayEvidenceController";

export function dualpayEvidenceRouter() {
  const router = Router();

  router.post("/evidence/run", async (req, res) => {
    const controller = new DualpayEvidenceController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.execute(req.body);
    res.json(result);
  });

  router.get("/evidence/health", async (req, res) => {
    const controller = new DualpayEvidenceController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.health();
    res.json(result);
  });

  return router;
}
