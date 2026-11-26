import { IconChevronDown } from "@tabler/icons-react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Collapse } from "@luftuj/shared/ui/collapse";
import { Dot, type Tone } from "@luftuj/shared/ui/dot";
import { ICON_STROKE, type IconComponent } from "@luftuj/shared/ui/icon-types";
import { cn } from "@luftuj/shared/utils/cn";

import { useOpenSection } from "./openSectionContext";

const CHIP_TONE: Partial<Record<Tone, string>> = {
  warning: "bg-warning-soft text-warning",
  destructive: "bg-destructive-soft text-destructive",
  plan: "bg-plan-soft text-plan",
};

/** A small state chip in a closed section's header: "Připojeno", "Podzim · do 20. 12.". */
export function SummaryChip({
  tone,
  mono,
  children,
}: Readonly<{ tone?: Tone; mono?: boolean; children: ReactNode }>) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-full bg-muted px-2.5 font-sans text-xs leading-4 font-medium whitespace-nowrap text-foreground",
        tone && CHIP_TONE[tone],
      )}
    >
      {tone && <Dot tone={tone} />}
      {mono ? <span className="font-mono text-[11px]">{children}</span> : children}
    </span>
  );
}

interface SettingsSectionProps {
  /** The section's key; also the `?section=` deep link. */
  value: string;
  /** "01"… */
  index: string;
  icon: IconComponent;
  title: string;
  description?: string;
  /** The state at a glance, shown while the section is closed (SummaryChips). */
  summary?: ReactNode;
  /** Unsaved changes: an amber dot on the icon. */
  dirty?: boolean;
  children: ReactNode;
}

/**
 * One collapsible settings area: number, icon (air while open), title and description, and the
 * current state as chips while closed, so nobody has to open it to learn whether it is fine. The content stays
 * mounted (forms keep their state) and animates with Collapse; closed, it is inert.
 */
export function SettingsSection({
  value,
  index,
  icon: Icon,
  title,
  description,
  summary,
  dirty,
  children,
}: Readonly<SettingsSectionProps>) {
  const { t } = useTranslation();
  const id = useId();
  // One section open at a time; the page owns which.
  const section = useOpenSection();
  const open = section.open === value;
  return (
    <section
      id={`section-${value}`}
      data-slot="settings-section"
      data-state={open ? "open" : "closed"}
      className="group/section scroll-mt-24 rounded-xl bg-card shadow-plane"
    >
      <h2 className="m-0 flex">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => section.setOpen(open ? null : value)}
          className={cn(
            "flex w-full cursor-pointer items-center gap-4 rounded-[inherit] border-0 bg-transparent px-6 py-5 text-left font-sans text-foreground",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "max-[560px]:flex-wrap max-[560px]:px-5 max-[560px]:py-4",
          )}
        >
          <span
            className={cn(
              "relative grid size-11 flex-none place-items-center rounded-md bg-muted text-foreground transition-[background-color,color] duration-(--duration-base)",
              "group-data-[state=open]/section:bg-air-soft group-data-[state=open]/section:text-air",
            )}
          >
            <Icon size={20} stroke={ICON_STROKE} aria-hidden />
            {dirty && (
              <i
                title={t("settings.unsavedChanges")}
                className="absolute -top-[3px] -right-[3px] size-3 animate-pop rounded-full bg-warning shadow-[0_0_0_2px_var(--card)]"
              />
            )}
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="legend">{index}</span>
            <span id={`${id}-title`} className="card-title">
              {title}
            </span>
            {description && <span className="caption text-muted-foreground">{description}</span>}
          </span>
          {summary && (
            <span
              className={cn(
                "flex max-w-[45%] flex-wrap justify-end gap-1.5 transition-opacity duration-(--duration-base)",
                "group-data-[state=open]/section:pointer-events-none group-data-[state=open]/section:opacity-0",
                "max-[560px]:order-3 max-[560px]:w-full max-[560px]:max-w-none max-[560px]:justify-start max-[560px]:pl-15 max-[560px]:group-data-[state=open]/section:hidden",
              )}
            >
              {summary}
            </span>
          )}
          <IconChevronDown
            size={20}
            stroke={ICON_STROKE}
            aria-hidden
            className="flex-none text-muted-foreground transition-[rotate] duration-(--duration-base) group-data-[state=open]/section:rotate-180"
          />
        </button>
      </h2>
      <div id={`${id}-body`} role="region" aria-labelledby={`${id}-title`}>
        <Collapse open={open}>
          {/* Bottom padding as the header's top (py-5, py-4 on phones), so the card closes as it opens. */}
          <div className="@container grid grid-cols-[minmax(0,1fr)] gap-4 pr-6 pb-5 pl-[84px] max-[560px]:px-5 max-[560px]:pb-4">
            {children}
          </div>
        </Collapse>
      </div>
    </section>
  );
}
