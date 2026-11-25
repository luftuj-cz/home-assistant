import { createContext, useContext } from "react";

export interface OpenSection {
  open: string | null;
  setOpen: (value: string | null) => void;
}

/** The one open settings section; SettingsPage provides it. */
export const OpenSectionContext = createContext<OpenSection>({
  open: null,
  setOpen: () => undefined,
});

export function useOpenSection() {
  return useContext(OpenSectionContext);
}
