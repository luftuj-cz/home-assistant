import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../../test/render";
import { PreferencesStep } from "./PreferencesStep";

const mocks = vi.hoisted(() => ({
  nextStep: vi.fn(),
  setSelectedLanguage: vi.fn(),
  setSelectedTheme: vi.fn(),
  saveLanguage: vi.fn(),
  saveTheme: vi.fn(),
  saveHemisphere: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "onboarding.preferences.languageLabel": "Language",
        "onboarding.preferences.languagePlaceholder": "Select language",
        "onboarding.preferences.themeLabel": "Appearance",
        "onboarding.preferences.themePlaceholder": "Select theme",
        "onboarding.preferences.themes.light": "Light",
        "onboarding.preferences.themes.dark": "Dark",
        "onboarding.preferences.seasonHemisphereLabel": "Season hemisphere",
        "onboarding.preferences.seasonHemispherePlaceholder": "Select hemisphere",
        "onboarding.preferences.seasonInfo": "Season modes use this hemisphere.",
        "settings.timeline.seasons.hemisphereNorthern": "Northern",
        "settings.timeline.seasons.hemisphereSouthern": "Southern",
        "onboarding.back": "Back",
        "onboarding.next": "Next",
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock("@luftuj/shared/i18n", () => ({
  setLanguage: vi.fn(),
}));

vi.mock("@luftuj/features/onboarding/hooks/useOnboardingWizard", () => ({
  useOnboardingWizard: () => ({
    nextStep: mocks.nextStep,
    prevStep: vi.fn(),
    selectedLanguage: "en",
    setSelectedLanguage: mocks.setSelectedLanguage,
    selectedTheme: "light",
    setSelectedTheme: mocks.setSelectedTheme,
    saveLanguageMutation: { mutateAsync: mocks.saveLanguage, isPending: false },
    saveThemeMutation: { mutateAsync: mocks.saveTheme, isPending: false },
  }),
}));

vi.mock("@luftuj/features/timeline/hooks/useSeasonHemisphere", () => ({
  useSeasonHemisphere: () => ({
    data: { hemisphere: "southern" },
    save: { mutateAsync: mocks.saveHemisphere, isPending: false },
  }),
}));

describe("PreferencesStep", () => {
  beforeEach(() => {
    mocks.nextStep.mockReset();
    mocks.saveLanguage.mockReset().mockResolvedValue(undefined);
    mocks.saveTheme.mockReset().mockResolvedValue(undefined);
    mocks.saveHemisphere.mockReset().mockResolvedValue(undefined);
  });

  it("shows season hemisphere information and saves the selected hemisphere", async () => {
    const user = userEvent.setup();
    renderWithMantine(<PreferencesStep />);

    expect(screen.getByText("Season modes use this hemisphere.")).not.toBeNull();
    await user.click(screen.getByText("Next"));

    expect(mocks.saveHemisphere).toHaveBeenCalledWith("southern");
    expect(mocks.nextStep).toHaveBeenCalled();
  });
});
