import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Room } from "@luftuj/features/automatic/api";
import { RoomDialog } from "@luftuj/features/automatic/components/RoomDialog";
import { useDeleteRoom, useRooms } from "@luftuj/features/automatic/hooks";
import { ConfirmDialog } from "@luftuj/features/timeline/components/ConfirmDialog";
import { Alert } from "@luftuj/shared/ui/alert";
import { Badge } from "@luftuj/shared/ui/badge";
import { Button } from "@luftuj/shared/ui/button";
import { Card, CardContent, CardHeader } from "@luftuj/shared/ui/card";
import { EmptyState } from "@luftuj/shared/ui/empty-state";
import { Skeleton } from "@luftuj/shared/ui/skeleton";

/** The rooms of automatic control, each set up with at least one sensor and one supply valve, or not. */
export function RoomsCard() {
  const { t } = useTranslation();
  const { data: rooms = [], isLoading, isError } = useRooms();
  const remove = useDeleteRoom();
  const [editing, setEditing] = useState<Room | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Room | null>(null);

  return (
    <Card>
      <CardHeader
        legend={t("automatic.rooms.legend")}
        title={t("automatic.rooms.title")}
        description={t("automatic.rooms.description")}
        action={
          <Button variant="secondary" size="sm" icon={IconPlus} onClick={() => setEditing(null)}>
            {t("automatic.rooms.add")}
          </Button>
        }
      />
      <CardContent>
        {isLoading && <Skeleton className="h-24" />}
        {isError && <Alert variant="destructive">{t("automatic.rooms.loadFailed")}</Alert>}
        {!isLoading && !isError && rooms.length === 0 && (
          <EmptyState
            title={t("automatic.rooms.empty")}
            description={t("automatic.rooms.emptyDescription")}
          />
        )}
        {rooms.length > 0 && (
          <ul className="m-0 flex list-none flex-col p-0">
            {rooms.map((room) => (
              <li
                key={room.id}
                className="flex flex-wrap items-center gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="label">{room.name}</span>
                  <span className="caption text-muted-foreground">
                    {t("automatic.rooms.counts", {
                      sensors: room.sensors.length,
                      valves: room.valves.length,
                    })}
                  </span>
                </div>
                <Badge variant={room.setUp ? "success" : "warning"}>
                  {room.setUp ? t("automatic.rooms.setUp") : t("automatic.rooms.notSetUp")}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  icon={IconEdit}
                  aria-label={t("automatic.rooms.edit", { name: room.name })}
                  onClick={() => setEditing(room)}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  icon={IconTrash}
                  aria-label={t("automatic.rooms.delete", { name: room.name })}
                  onClick={() => setDeleting(room)}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing !== undefined && (
        <RoomDialog
          key={editing?.id ?? "new"}
          open
          room={editing}
          rooms={rooms}
          onOpenChange={(open) => {
            if (!open) setEditing(undefined);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t("automatic.rooms.deleteTitle")}
        confirmLabel={t("automatic.rooms.deleteConfirm")}
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, { onSettled: () => setDeleting(null) });
        }}
      >
        {t("automatic.rooms.deleteText", { name: deleting?.name ?? "" })}
      </ConfirmDialog>
    </Card>
  );
}
