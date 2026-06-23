import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../../test/render";
import { SeasonalModeModal } from "./SeasonalModeModal";

const mocks = vi.hoisted(() => ({
  useTimelineModesQuery: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { season?: string; defaultValue?: string }) => {
      if (options?.defaultValue) return options.defaultValue;
      const labels: Record<string, string> = {
        "settings.timeline.seasons.editTitle": `Edit ${options?.season ?? ""} mode`,
        "settings.timeline.seasons.createTitle": `Create ${options?.season ?? ""} mode`,
        "settings.timeline.seasons.summer": "Summer",
        "settings.timeline.seasons.baseModeLabel": "Base mode",
        "settings.timeline.seasons.overridePower": "Override power",
        "settings.timeline.seasons.overrideTemperature": "Override temperature",
        "settings.timeline.seasons.overrideVariables": "Override variables",
        "settings.timeline.seasons.overrideValves": "Override valves",
        "settings.timeline.hruSettings": "HRU settings",
        "settings.timeline.enabled": "Enabled",
        "settings.timeline.modal.cancel": "Cancel",
        "settings.timeline.modal.save": "Save",
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock("../hooks/useTimelineModesQuery", () => ({
  useTimelineModesQuery: mocks.useTimelineModesQuery,
}));

describe("SeasonalModeModal", () => {
  beforeEach(() => {
    mocks.useTimelineModesQuery.mockReturnValue({
      modes: [{ id: 1, name: "Base mode" }],
    });
  });

  it("saves a base mode without optional overrides", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderWithMantine(
      <SeasonalModeModal
        opened
        season="summer"
        initial={{
          season: "summer",
          hruId: null,
          baseModeId: 1,
          power: null,
          temperature: null,
          variables: null,
          luftatorConfig: null,
          enabled: true,
        }}
        unitId={null}
        valves={[]}
        hruVariables={[]}
        maxPower={100}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        pending={false}
      />,
    );

    await user.click(screen.getByText("Save"));

    expect(onSubmit).toHaveBeenCalledWith({
      baseModeId: 1,
      power: null,
      temperature: null,
      variables: null,
      luftatorConfig: null,
      enabled: true,
    });
  });

  it("can add variable and valve overrides", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderWithMantine(
      <SeasonalModeModal
        opened
        season="summer"
        initial={{
          season: "summer",
          hruId: "unit-a",
          baseModeId: 1,
          power: null,
          temperature: null,
          variables: null,
          luftatorConfig: null,
          enabled: true,
        }}
        unitId="unit-a"
        valves={[
          {
            entityId: "number.luftator_kitchen",
            name: "Kitchen",
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            state: "available",
            isAvailable: true,
            attributes: {},
          },
        ]}
        hruVariables={[
          {
            name: "fan",
            type: "number",
            editable: true,
            label: "Fan speed",
            min: 1,
            max: 5,
            step: 1,
          },
        ]}
        maxPower={100}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        pending={false}
      />,
    );

    await user.click(screen.getByLabelText("Fan speed"));
    await user.click(screen.getByLabelText("Kitchen"));
    await user.click(screen.getByText("Save"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { fan: 1 },
        luftatorConfig: { "number.luftator_kitchen": 0 },
      }),
    );
  });

  it("can remove existing variable and valve overrides", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderWithMantine(
      <SeasonalModeModal
        opened
        season="summer"
        initial={{
          season: "summer",
          hruId: "unit-a",
          baseModeId: 1,
          power: null,
          temperature: null,
          variables: { fan: 2 },
          luftatorConfig: { number_luftator_kitchen: 50 },
          enabled: true,
        }}
        unitId="unit-a"
        valves={[
          {
            entityId: "number_luftator_kitchen",
            name: "Kitchen",
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            state: "available",
            isAvailable: true,
            attributes: {},
          },
        ]}
        hruVariables={[
          {
            name: "fan",
            type: "number",
            editable: true,
            label: "Fan speed",
            min: 1,
            max: 5,
            step: 1,
          },
        ]}
        maxPower={100}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        pending={false}
      />,
    );

    await user.click(screen.getByLabelText("Fan speed"));
    await user.click(screen.getByLabelText("Kitchen"));
    await user.click(screen.getByText("Save"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: null,
        luftatorConfig: null,
      }),
    );
  });
});
