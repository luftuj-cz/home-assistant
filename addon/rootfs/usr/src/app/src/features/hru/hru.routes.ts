import { Router } from "express";
import { HruController } from "./hru.controller";

export function createHruRouter(controller: HruController): Router {
  const router = Router();

  router.get("/units", controller.getUnits);
  router.get("/modes", controller.getModes);
  router.get("/read", controller.read);
  router.post("/write", controller.write);

  return router;
}
