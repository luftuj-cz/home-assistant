import { Accordion } from "@mantine/core";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../../test/render";
import { SeasonsSection } from "./SeasonsSection";

const mocks = vi.hoisted(() => ({
  useSeasonHemisphere: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "settings.timeline.seasons.title": "Seasonal Modes",
        "settings.timeline.seasons.hemisphere": "Hemisphere",
        "settings.timeline.seasons.hemisphereNorthern": "Northern",
        "settings.timeline.seasons.hemisphereSouthern": "Southern",
        "settings.timeline.seasons.description": "Description",
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock("@luftuj/features/timeline/hooks/useSeasonHemisphere", () => ({
  useSeasonHemisphere: mocks.useSeasonHemisphere,
}));

describe("SeasonsSection", () => {
  beforeEach(() => {
    mocks.mutate.mockReset();
    mocks.useSeasonHemisphere.mockReturnValue({
      data: { hemisphere: "southern" },
      save: { mutate: mocks.mutate },
    });
  });

  it("renders season guidance and current hemisphere selection", () => {
    renderWithMantine(
      <Accordion defaultValue="seasons">
        <SeasonsSection />
      </Accordion>,
    );

    expect(screen.getByText("Description")).not.toBeNull();
    expect(screen.getAllByLabelText("Hemisphere")[0]).toHaveValue("Southern");
  });
});
