import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import type { ValveController } from "../core/valveManager.js";
import {
  deleteValveGroup,
  getValveGroup,
  getValveGroups,
  setGroupMembers,
  upsertValveGroup,
} from "../services/database.js";
import { validateParams, validateRequest } from "../middleware/validateRequest.js";
import {
  type ValveGroupBulkSetBody,
  valveGroupBulkSetBodySchema,
  type ValveGroupIdParams,
  valveGroupIdParamsSchema,
  type ValveGroupInput,
  valveGroupInputSchema,
  type ValveGroupMembersBody,
  valveGroupMembersBodySchema,
} from "../schemas/valveGroups.js";
import { ConflictError, NotFoundError } from "../shared/errors/apiErrors.js";

export function createValveGroupsRouter(valveManager: ValveController, logger: Logger) {
  const router = Router();

  router.get("/", (_request: Request, response: Response, next: NextFunction) => {
    try {
      const groups = getValveGroups();
      response.json(groups);
    } catch (error) {
      logger.error({ error }, "Failed to get valve groups");
      next(error);
    }
  });

  router.post(
    "/",
    validateRequest(valveGroupInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      const body = request.body as ValveGroupInput;
      try {
        const group = upsertValveGroup(body);
        logger.info({ id: group.id, name: group.name }, "Valve group created");
        response.status(201).json(group);
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
          return next(new ConflictError("Group name already exists", "DUPLICATE_GROUP_NAME"));
        }
        logger.error({ error }, "Failed to create valve group");
        next(error);
      }
    },
  );

  router.put(
    "/:id",
    validateParams(valveGroupIdParamsSchema),
    validateRequest(valveGroupInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      const { id } = request.params as ValveGroupIdParams;
      const groupId = Number(id);
      const body = request.body as ValveGroupInput;

      try {
        const existing = getValveGroup(groupId);
        if (!existing) {
          return next(new NotFoundError("Group not found", "GROUP_NOT_FOUND"));
        }
        // sortOrder is optional in the schema - a caller updating just the name
        // (e.g. a rename) must not have the group's position silently reset to the
        // front just because it omitted a field it never intended to change.
        const group = upsertValveGroup({
          ...body,
          sortOrder: body.sortOrder ?? existing.sortOrder,
          id: groupId,
        });
        logger.info({ id: group.id, name: group.name }, "Valve group updated");
        response.json(group);
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
          return next(new ConflictError("Group name already exists", "DUPLICATE_GROUP_NAME"));
        }
        logger.error({ error, groupId }, "Failed to update valve group");
        next(error);
      }
    },
  );

  router.delete(
    "/:id",
    validateParams(valveGroupIdParamsSchema),
    (request: Request, response: Response, next: NextFunction) => {
      const { id } = request.params as ValveGroupIdParams;
      const groupId = Number(id);

      try {
        const existing = getValveGroup(groupId);
        if (!existing) {
          return next(new NotFoundError("Group not found", "GROUP_NOT_FOUND"));
        }
        deleteValveGroup(groupId);
        logger.info({ id: groupId }, "Valve group deleted");
        response.status(204).end();
      } catch (error) {
        logger.error({ error, groupId }, "Failed to delete valve group");
        next(error);
      }
    },
  );

  router.put(
    "/:id/members",
    validateParams(valveGroupIdParamsSchema),
    validateRequest(valveGroupMembersBodySchema),
    (request: Request, response: Response, next: NextFunction) => {
      const { id } = request.params as ValveGroupIdParams;
      const groupId = Number(id);
      const { entityIds } = request.body as ValveGroupMembersBody;

      try {
        const existing = getValveGroup(groupId);
        if (!existing) {
          return next(new NotFoundError("Group not found", "GROUP_NOT_FOUND"));
        }
        setGroupMembers(groupId, entityIds);
        logger.info({ groupId, count: entityIds.length }, "Valve group members updated");
        response.json(getValveGroup(groupId));
      } catch (error) {
        logger.error({ error, groupId }, "Failed to set valve group members");
        next(error);
      }
    },
  );

  router.post(
    "/:id/bulk-set",
    validateParams(valveGroupIdParamsSchema),
    validateRequest(valveGroupBulkSetBodySchema),
    async (request: Request, response: Response, next: NextFunction) => {
      const { id } = request.params as ValveGroupIdParams;
      const groupId = Number(id);
      const { value } = request.body as ValveGroupBulkSetBody;

      try {
        const group = getValveGroup(groupId);
        if (!group) {
          return next(new NotFoundError("Group not found", "GROUP_NOT_FOUND"));
        }

        const snapshot = await valveManager.getSnapshot();
        const snapshotByEntityId = new Map(snapshot.map((valve) => [valve.entity_id, valve]));

        const settled = await Promise.allSettled(
          group.entityIds.map((entityId) => {
            const valve = snapshotByEntityId.get(entityId);
            const min = Number(valve?.attributes?.min ?? 0);
            const max = Number(valve?.attributes?.max ?? 90);
            const clamped = Math.min(Math.max(value, min), max);
            return valveManager.setValue(entityId, clamped);
          }),
        );

        const failed = settled
          .map((result, index) => ({ entityId: group.entityIds[index], result }))
          .filter(
            (entry): entry is { entityId: string; result: PromiseRejectedResult } =>
              entry.entityId !== undefined && entry.result.status === "rejected",
          );

        if (failed.length > 0) {
          logger.error(
            { groupId, value, failed: failed.map((f) => f.entityId) },
            "Bulk set failed for some valves in group",
          );
        }
        logger.info(
          { groupId, value, succeeded: settled.length - failed.length, failed: failed.length },
          "Bulk set valve group values",
        );

        response.status(failed.length > 0 ? 207 : 200).json({
          succeeded: settled.length - failed.length,
          failed: failed.map((f) => f.entityId),
        });
      } catch (error) {
        logger.error({ error, groupId, value }, "Failed to bulk set valve group values");
        next(error);
      }
    },
  );

  return router;
}
