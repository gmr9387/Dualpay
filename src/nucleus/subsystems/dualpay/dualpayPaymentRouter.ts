// src/nucleus/subsystems/dualpay/dualpayPaymentRouter.ts

import { Router } from "express";
import { DualpayPaymentController } from "./dualpayPaymentController";

export function dualpayPaymentRouter() {
  const router = Router();

  router.post("/payment/run", async (req, res) => {
    const controller = new DualpayPaymentController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.execute(req.body);
    res.json(result);
  });

  router.get("/payment/health", async (req, res) => {
    const controller = new DualpayPaymentController(
      req.headers["x-org-id"] as string
    );
    const result = await controller.health();
    res.json(result);
  });

  return router;
}
