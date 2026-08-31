// src/nucleus/subsystems/dualpay/dualpayRouterBinding.ts

import { dualpayRouter } from "./dualpayRouter";

export function bindDualpayRoutes(app: any) {
  app.use("/dualpay", dualpayRouter());
}
