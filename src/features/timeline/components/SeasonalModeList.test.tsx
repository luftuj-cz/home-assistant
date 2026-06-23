import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../../test/render";
import { SeasonalModeList } from "./SeasonalModeList";

const mocks = vi.hoisted(() => ({
  useSeasonalModesQuery: vi.fn(),
  useSeasonHemisphere: vi.fn(),
  removeMutate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "settings.timeline.seasons.title": "Seasonal Modes",
        "settings.timeline.seasons.description": "Override mode settings per season.",
        "settings.timeline.seasons.currentSeason": "Current season",
        "settings.timeline.seasons.spring": "Spring",
        "settings.timeline.seasons.summer": "Summer",
        "settings.timeline.seasons.autumn": "Autumn",
        "settings.timeline.seasons.winter": "Winter",
        "settings.timeline.seasons.configured": "Configured",
        "settings.timeline.seasons.notConfigured": "Not configured",
        "settings.timeline.seasons.remove": "Remove seasonal override",
        "settings.timeline.modeCreateAction": "Create",
        "settings.timeline.edit": "Edit",
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock("../hooks/useSeasonalModesQuery", () => ({
  useSeasonalModesQuery: mocks.useSeasonalModesQuery,
}));

vi.mock("../hooks/useSeasonHemisphere", () => ({
  useSeasonHemisphere: mocks.useSeasonHemisphere,
}));

vi.mock("./SeasonalModeModal", () => ({
  SeasonalModeModal: () => null,
}));

describe("SeasonalModeList", () => {
  beforeEach(() => {
    mocks.removeMutate.mockReset();
    mocks.useSeasonHemisphere.mockReturnValue({ data: { hemisphere: "northern" } });
    mocks.useSeasonalModesQuery.mockReturnValue({
      data: [
        {
          season: "summer",
          hruId: null,
          baseModeId: 1,
          power: null,
          temperature: null,
          variables: null,
          luftatorConfig: null,
          enabled: true,
        },
      ],
      isLoading: false,
      save: { isPending: false, mutate: vi.fn() },
      remove: { mutate: mocks.removeMutate },
    });
  });

  it("renders all seasons with configured state", () => {
    renderWithMantine(
      <SeasonalModeList unitId={null} valves={[]} hruVariables={[]} maxPower={100} />,
    );

    expect(screen.getByText("Seasonal Modes")).not.toBeNull();
    expect(screen.getAllByText("Summer").length).toBeGreaterThan(0);
    expect(screen.getByText("Configured")).not.toBeNull();
    expect(screen.getAllByText("Not configured")).toHaveLength(3);
  });

  it("deletes a configured seasonal mode", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <SeasonalModeList unitId={null} valves={[]} hruVariables={[]} maxPower={100} />,
    );

    await user.click(screen.getByRole("button", { name: /Summer/ }));
    await user.click(screen.getByText("Remove seasonal override"));

    expect(mocks.removeMutate).toHaveBeenCalledWith("summer", expect.any(Object));
  });
});
