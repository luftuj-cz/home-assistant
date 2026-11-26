import { IconPlus, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Room, RoomSensor, SensorCandidate } from "@luftuj/features/automatic/api";
import { useSaveRoom, useSensorCandidates } from "@luftuj/features/automatic/hooks";
import { fetchValveGroups, fetchValves } from "@luftuj/features/valves/api";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { Combobox, MultiSelect, type ComboOption } from "@luftuj/shared/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@luftuj/shared/ui/dialog";
import { Field } from "@luftuj/shared/ui/field";
import { Input } from "@luftuj/shared/ui/input";

interface RoomDialogProps {
  open: boolean;
  /** Null creates a room. */
  room: Room | null;
  rooms: Room[];
  onOpenChange: (open: boolean) => void;
}

function valueKey(attribute: string | null): string {
  return attribute ?? "";
}

function valueLabel(attribute: string | null, stateLabel: string): string {
  return attribute ?? stateLabel;
}

function formatValue(value: number, unit: string | null): string {
  return unit ? `${value} ${unit}` : String(value);
}

function SensorRow({
  sensor,
  candidate,
  onRemove,
}: Readonly<{ sensor: RoomSensor; candidate: SensorCandidate | undefined; onRemove: () => void }>) {
  const { t } = useTranslation();
  const value = candidate?.values.find((v) => v.attribute === sensor.attribute);
  return (
    <li className="flex items-center gap-3 rounded-md bg-muted px-3 py-2">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="label truncate">{candidate?.name ?? sensor.entityId}</span>
        <span className="code truncate text-muted-foreground">
          {sensor.entityId} · {valueLabel(sensor.attribute, t("automatic.rooms.stateValue"))}
        </span>
      </div>
      <span className="readout-sm tabular-nums">
        {value ? formatValue(value.value, value.unit) : t("automatic.rooms.noValue")}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        icon={IconX}
        aria-label={t("automatic.rooms.removeSensor")}
        onClick={onRemove}
      />
    </li>
  );
}

/**
 * A room of automatic control: its name, its CO₂ sensors (an entity, then the value that holds CO₂: the state or
 * an attribute, with a live preview) and its supply valves (one by one, or a valve group's at once).
 */
export function RoomDialog({ open, room, rooms, onOpenChange }: Readonly<RoomDialogProps>) {
  const { t } = useTranslation();
  const [name, setName] = useState(room?.name ?? "");
  const [sensors, setSensors] = useState<RoomSensor[]>(room?.sensors ?? []);
  const [valves, setValves] = useState<string[]>(room?.valves ?? []);
  const [pickedEntity, setPickedEntity] = useState<string | null>(null);
  const [pickedValue, setPickedValue] = useState<string | null>(null);
  const save = useSaveRoom();
  const candidates = useSensorCandidates(open);
  const valveList = useQuery({
    queryKey: ["automatic", "valves"],
    queryFn: fetchValves,
    enabled: open,
  });
  const groups = useQuery({
    queryKey: ["automatic", "groups"],
    queryFn: fetchValveGroups,
    enabled: open,
  });

  const others = useMemo(() => rooms.filter((other) => other.id !== room?.id), [rooms, room]);
  const takenSensors = useMemo(
    () => new Set(others.flatMap((other) => other.sensors.map((sensor) => sensor.entityId))),
    [others],
  );
  const takenValves = useMemo(() => new Set(others.flatMap((other) => other.valves)), [others]);
  const byEntity = useMemo(
    () => new Map((candidates.data ?? []).map((candidate) => [candidate.entityId, candidate])),
    [candidates.data],
  );

  const entityOptions: ComboOption[] = (candidates.data ?? [])
    .filter((c) => !takenSensors.has(c.entityId) && !sensors.some((s) => s.entityId === c.entityId))
    .map((c) => ({
      value: c.entityId,
      label: c.name,
      code: c.entityId,
      group:
        c.deviceClass === "carbon_dioxide" || c.unit?.toLowerCase() === "ppm"
          ? t("automatic.rooms.co2Sensors")
          : t("automatic.rooms.otherSensors"),
    }));
  const picked = pickedEntity ? byEntity.get(pickedEntity) : undefined;
  const valueOptions: ComboOption[] = (picked?.values ?? []).map((v) => ({
    value: valueKey(v.attribute),
    label: valueLabel(v.attribute, t("automatic.rooms.stateValue")),
    meta: formatValue(v.value, v.unit),
  }));

  const valveOptions: ComboOption[] = (valveList.data ?? [])
    .filter((valve) => !takenValves.has(valve.entityId))
    .map((valve) => ({ value: valve.entityId, label: valve.name, code: valve.entityId }));
  const groupOptions: ComboOption[] = (groups.data ?? []).map((group) => ({
    value: String(group.id),
    label: group.name,
    meta: String(group.entityIds.length),
  }));

  function pickEntity(entityId: string | null) {
    setPickedEntity(entityId);
    const values = entityId ? (byEntity.get(entityId)?.values ?? []) : [];
    // One value, or a CO₂ entity's state: nothing to choose.
    setPickedValue(values.length === 1 ? valueKey(values[0]!.attribute) : null);
  }

  function addSensor() {
    if (!pickedEntity || pickedValue === null) return;
    setSensors([...sensors, { entityId: pickedEntity, attribute: pickedValue || null }]);
    setPickedEntity(null);
    setPickedValue(null);
  }

  function addGroup(groupId: string | null) {
    const group = groups.data?.find((candidate) => String(candidate.id) === groupId);
    if (!group) return;
    const added = group.entityIds.filter((id) => !takenValves.has(id) && !valves.includes(id));
    setValves([...valves, ...added]);
  }

  function submit() {
    save.mutate(
      { id: room?.id ?? null, input: { name: name.trim(), sensors, valves } },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" scroll>
        <DialogHeader
          legend={t("automatic.rooms.legend")}
          title={room ? t("automatic.rooms.editTitle") : t("automatic.rooms.newTitle")}
          description={t("automatic.rooms.dialogDescription")}
        />
        <DialogBody className="grid gap-5">
          <Field label={t("automatic.rooms.name")}>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>

          <section className="grid gap-2">
            <h3 className="label m-0">{t("automatic.rooms.sensors")}</h3>
            <p className="caption m-0 text-muted-foreground">{t("automatic.rooms.sensorsHint")}</p>
            {sensors.length > 0 && (
              <ul className="m-0 grid list-none gap-2 p-0">
                {sensors.map((sensor) => (
                  <SensorRow
                    key={sensor.entityId}
                    sensor={sensor}
                    candidate={byEntity.get(sensor.entityId)}
                    onRemove={() => setSensors(sensors.filter((s) => s !== sensor))}
                  />
                ))}
              </ul>
            )}
            {candidates.isError && (
              <Alert variant="warning">{t("automatic.rooms.candidatesFailed")}</Alert>
            )}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
              <Field label={t("automatic.rooms.sensorEntity")}>
                <Combobox
                  options={entityOptions}
                  value={pickedEntity}
                  onValueChange={pickEntity}
                  placeholder={t("automatic.rooms.pickSensor")}
                  searchable
                  emptyText={t("automatic.rooms.noCandidates")}
                />
              </Field>
              <Field label={t("automatic.rooms.sensorValue")}>
                <Combobox
                  options={valueOptions}
                  value={pickedValue}
                  onValueChange={setPickedValue}
                  placeholder={t("automatic.rooms.pickValue")}
                  disabled={!picked}
                />
              </Field>
              <Button
                variant="secondary"
                icon={IconPlus}
                disabled={!pickedEntity || pickedValue === null}
                onClick={addSensor}
              >
                {t("automatic.rooms.addSensor")}
              </Button>
            </div>
          </section>

          <section className="grid gap-2">
            <h3 className="label m-0">{t("automatic.rooms.valves")}</h3>
            <p className="caption m-0 text-muted-foreground">{t("automatic.rooms.valvesHint")}</p>
            <MultiSelect
              options={valveOptions}
              value={valves}
              onValueChange={setValves}
              placeholder={t("automatic.rooms.pickValves")}
              aria-label={t("automatic.rooms.valves")}
            />
            {groupOptions.length > 0 && (
              <Field label={t("automatic.rooms.addGroup")}>
                <Combobox
                  options={groupOptions}
                  value={null}
                  onValueChange={addGroup}
                  placeholder={t("automatic.rooms.pickGroup")}
                />
              </Field>
            )}
          </section>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("ui.cancel")}
          </Button>
          <Button onClick={submit} loading={save.isPending} disabled={name.trim() === ""}>
            {t("automatic.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
