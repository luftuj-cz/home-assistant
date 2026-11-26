import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { AutomaticStatus, RoomStatus, SensorStatus } from "@luftuj/features/automatic/api";
import { useAutomaticStatus } from "@luftuj/features/automatic/hooks";
import { Alert } from "@luftuj/shared/ui/alert";
import { Badge } from "@luftuj/shared/ui/badge";
import { Card, CardContent, CardHeader } from "@luftuj/shared/ui/card";
import { Skeleton } from "@luftuj/shared/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@luftuj/shared/ui/table";

function stateBadge(status: AutomaticStatus, t: TFunction) {
  if (!status.active) return <Badge variant="secondary">{t("automatic.status.inactive")}</Badge>;
  if (status.reason) return <Badge variant="warning">{t("automatic.status.cannotRun")}</Badge>;
  if (!status.branch) return <Badge variant="air">{t("automatic.status.starting")}</Badge>;
  return <Badge variant="success">{t("automatic.status.running")}</Badge>;
}

/** "45 s", "12 min", "2 h 5 min". */
function formatAge(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function sensorText(sensor: SensorStatus, t: TFunction): string {
  const value = sensor.attribute ? `${sensor.entityId} · ${sensor.attribute}` : sensor.entityId;
  if (sensor.problem) return `${value}: ${t(`automatic.problems.${sensor.problem}`)}`;
  if (sensor.ppm === null) return `${value}: —`;
  const age =
    sensor.ageSeconds === null
      ? ""
      : ` · ${t("automatic.status.age", { age: formatAge(sensor.ageSeconds) })}`;
  return `${value}: ${Math.round(sensor.ppm)} ppm${age}`;
}

/** Engine power on the 0–10 scale, to one decimal ("3.3"). */
function power(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function ppm(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}`;
}

function RoomRow({ room }: Readonly<{ room: RoomStatus }>) {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell className="font-medium">{room.name}</TableCell>
      {room.setUp ? (
        <>
          <TableCell className="tabular-nums">{ppm(room.co2)}</TableCell>
          <TableCell className="tabular-nums">{ppm(room.filteredCo2)}</TableCell>
          <TableCell>
            {room.condition ? t(`automatic.conditions.${room.condition}`) : "—"}
            {room.inCooldown && (
              <span className="caption block text-muted-foreground">
                {t("automatic.status.cooldown")}
              </span>
            )}
          </TableCell>
          <TableCell className="tabular-nums">
            {room.valves
              .map((valve) => (valve.position === null ? "?" : `${valve.position}°`))
              .join(" · ")}
          </TableCell>
          <TableCell>
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {room.sensors.map((sensor) => (
                <li
                  key={sensor.entityId}
                  className={
                    sensor.problem ? "caption text-warning" : "caption text-muted-foreground"
                  }
                >
                  {sensorText(sensor, t)}
                </li>
              ))}
            </ul>
          </TableCell>
        </>
      ) : (
        <TableCell colSpan={5} className="text-muted-foreground">
          {t("automatic.rooms.notSetUp")}
        </TableCell>
      )}
    </TableRow>
  );
}

/** Whether automatic control runs, why not, what it decided last and how each room stands. */
export function StatusCard() {
  const { t } = useTranslation();
  const { data: status, isLoading, isError } = useAutomaticStatus();

  if (isLoading) return <Skeleton className="h-48" />;
  if (isError || !status) {
    return <Alert variant="destructive">{t("automatic.status.loadFailed")}</Alert>;
  }

  const unit = status.power?.unit;
  return (
    <Card>
      <CardHeader
        legend={t("automatic.status.legend")}
        title={t("automatic.status.title")}
        action={stateBadge(status, t)}
      />
      <CardContent className="grid gap-4">
        {!status.active && (
          <p className="body m-0 text-muted-foreground">
            {t("automatic.status.inactiveBecause", { source: status.sourceName })}
          </p>
        )}
        {status.active && status.reason && (
          <Alert variant="warning" title={t(`automatic.reasons.${status.reason}`)}>
            {t("automatic.status.safeState")}
          </Alert>
        )}
        {status.active && !status.reason && status.branch && (
          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            <div>
              <dt className="legend">{t("automatic.status.branch")}</dt>
              <dd className="m-0">{t(`automatic.branches.${status.branch}`)}</dd>
            </div>
            <div>
              <dt className="legend">{t("automatic.status.power")}</dt>
              <dd className="m-0 tabular-nums">
                {status.power
                  ? `${power(status.power.before)} → ${power(status.power.after)} / ${power(status.power.max)}`
                  : "—"}
                {unit && (
                  <span className="caption block text-muted-foreground">
                    {t("automatic.status.powerUnit", unit)}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="legend">{t("automatic.status.fluctuation")}</dt>
              <dd className="m-0">
                {status.fluctuationActive ? t("automatic.status.on") : t("automatic.status.off")}
              </dd>
            </div>
            <div>
              <dt className="legend">{t("automatic.status.engineTime")}</dt>
              <dd className="m-0 tabular-nums">{status.engineTime ?? "—"}</dd>
            </div>
          </dl>
        )}
        {status.rooms.length > 0 && (
          <Table dense>
            <TableHeader>
              <TableRow>
                <TableHead>{t("automatic.status.room")}</TableHead>
                <TableHead>{t("automatic.status.co2")}</TableHead>
                <TableHead>{t("automatic.status.filtered")}</TableHead>
                <TableHead>{t("automatic.status.condition")}</TableHead>
                <TableHead>{t("automatic.status.valves")}</TableHead>
                <TableHead>{t("automatic.status.sensors")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.rooms.map((room) => (
                <RoomRow key={room.id} room={room} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
