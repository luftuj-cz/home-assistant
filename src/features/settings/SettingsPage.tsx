import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { OpenSectionContext } from "@luftuj/features/settings/components/openSectionContext";
import { AppearanceSection } from "@luftuj/features/settings/sections/AppearanceSection";
import { DatabaseSection } from "@luftuj/features/settings/sections/DatabaseSection";
import { DeveloperSection } from "@luftuj/features/settings/sections/DeveloperSection";
import { HelpSection } from "@luftuj/features/settings/sections/HelpSection";
import { HruSection } from "@luftuj/features/settings/sections/HruSection";
import { MqttSection } from "@luftuj/features/settings/sections/MqttSection";
import { PlansSection } from "@luftuj/features/settings/sections/PlansSection";
import { SeasonsSection } from "@luftuj/features/settings/sections/SeasonsSection";
import { PageHeader } from "@luftuj/shared/ui/page-header";
import { cn } from "@luftuj/shared/utils/cn";

const SECTIONS = [
  { value: "appearance", title: "settings.appearance.title" },
  { value: "hru", title: "settings.hru.title" },
  { value: "seasons", title: "settings.seasons.title" },
  { value: "plans", title: "settings.customTimelines.title" },
  { value: "mqtt", title: "settings.mqtt.title" },
  { value: "database", title: "settings.database.title" },
  { value: "help", title: "settings.help.title" },
  { value: "developer", title: "settings.developer.title" },
] as const;

/** A little longer than Collapse's height transition (--duration-slow, 320 ms), so the stack has settled. */
const FOLLOW_MS = 450;

/**
 * Scrolls a section's top under the sticky header (its scroll-margin) while the section above it closes and it
 * opens. The target is measured again every frame: a one-off scrollIntoView aims where the section was before the
 * stack moved and overshoots by the height of the closing section. Wheel or touch hands the scroll back.
 */
function followSection(id: string) {
  const section = document.getElementById(id);
  if (!section) return;
  const instant = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const from = scrollY;
  let start = 0;
  let raf = 0;

  function target(el: HTMLElement) {
    const margin = Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    return Math.max(0, Math.min(max, scrollY + el.getBoundingClientRect().top - margin));
  }

  function stop() {
    cancelAnimationFrame(raf);
    removeEventListener("wheel", stop);
    removeEventListener("touchstart", stop);
  }

  function frame(now: number) {
    start ||= now;
    const t = instant ? 1 : Math.min(1, (now - start) / FOLLOW_MS);
    const eased = 1 - (1 - t) ** 3;
    scrollTo({ top: from + (target(section as HTMLElement) - from) * eased, behavior: "instant" });
    if (t < 1) raf = requestAnimationFrame(frame);
    else stop();
  }

  addEventListener("wheel", stop, { passive: true });
  addEventListener("touchstart", stop, { passive: true });
  raf = requestAnimationFrame(frame);
}

/**
 * Nastavení: a sticky numbered index on the left (desktop), the section stack on the right, one section open at a
 * time. `?section=` opens one and scrolls to it, so other pages can link to the setting they talk about.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { section } = useSearch({ from: "/settings" }) as { section?: string };
  const navigate = useNavigate({ from: "/settings" });
  const [open, setOpenState] = useState<string | null>(section ?? "appearance");
  const linked = useRef(section);

  // A deep link opens its section and brings it into view once the stack is laid out - also when the link
  // arrives while the page is already open (only the search changes).
  useEffect(() => {
    if (!section || section === linked.current) return;
    linked.current = section;
    setOpenState(section);
  }, [section]);
  useEffect(() => {
    const target = linked.current;
    if (!target) return;
    const id = setTimeout(() => {
      document
        .getElementById(`section-${target}`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 120);
    return () => clearTimeout(id);
  }, []);

  const context = useMemo(
    () => ({
      open,
      setOpen: (value: string | null) => {
        setOpenState(value);
        // Only the open section changes: keep the scroll (the router resets it to the top by default).
        void navigate({
          search: value ? { section: value } : {},
          replace: true,
          resetScroll: false,
        });
      },
    }),
    [navigate, open],
  );

  function jump(value: string) {
    context.setOpen(value);
    followSection(`section-${value}`);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 font-sans text-sm leading-5 text-foreground max-md:gap-4">
      <PageHeader title={t("settings.title")} description={t("settings.description")} />
      <OpenSectionContext.Provider value={context}>
        <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-8 max-lg:grid-cols-[minmax(0,1fr)]">
          <nav
            aria-label={t("settings.indexLabel")}
            className="sticky top-24 grid gap-0.5 max-lg:hidden"
          >
            {SECTIONS.map((entry, index) => (
              <button
                key={entry.value}
                type="button"
                aria-current={open === entry.value ? "true" : undefined}
                onClick={() => jump(entry.value)}
                className={cn(
                  "flex h-9 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 text-left font-sans text-sm text-muted-foreground",
                  "transition-[background-color,color] duration-(--duration-fast) hover:bg-muted hover:text-foreground",
                  "aria-[current=true]:bg-muted aria-[current=true]:font-medium aria-[current=true]:text-foreground",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <span className="code w-5 text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {t(entry.title)}
              </button>
            ))}
          </nav>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <AppearanceSection />
            <HruSection />
            <SeasonsSection />
            <PlansSection />
            <MqttSection />
            <DatabaseSection />
            <HelpSection />
            <DeveloperSection />
          </div>
        </div>
      </OpenSectionContext.Provider>
    </div>
  );
}
