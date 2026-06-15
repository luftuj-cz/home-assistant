import { Router } from "express";
import { HruController } from "./hru.controller.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { hruWriteInputSchema } from "../../schemas/hru.js";

export function createHruRouter(controller: HruController): Router {
  const router = Router();

  router.get("/units", controller.getUnits);
  router.get("/modes", controller.getModes);
  router.get("/read", controller.read);
  router.post("/test", controller.test);
  router.post("/write", validateRequest(hruWriteInputSchema), controller.write);

  return router;
}
