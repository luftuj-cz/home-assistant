import { Router } from "express";
import { HruController } from "./hru.controller.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { hruWriteInputSchema } from "../../schemas/hru.js";
import { hruSettingsInputSchema } from "../../schemas/settings.js";

export function createHruRouter(controller: HruController): Router {
  const router = Router();

  router.get("/units", controller.getUnits);
  router.get("/modes", controller.getModes);
  router.get("/read", controller.read);
  router.post("/test", validateRequest(hruSettingsInputSchema), controller.test);
  router.post("/write", validateRequest(hruWriteInputSchema), controller.write);

  return router;
}
