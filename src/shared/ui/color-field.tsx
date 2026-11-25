import { IconCheck } from "@tabler/icons-react";
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { fieldSurface } from "./input";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

interface Swatch {
  /** A colour, usually `var(--mode-n)` or its hex. */
  value: string;
  label: string;
}

interface ColorFieldProps {
  /** Hex or a palette value. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (color: string) => void;
  /** The palette (the `mode-1…8` colours). */
  swatches: Swatch[];
  className?: string;
}

function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * A mode colour: the palette first, then a hex field with the native picker for anything else. Palette colours have
 * light and dark variants that keep contrast; a custom hex is one value for both themes. An invalid hex is marked
 * and not applied; leaving the field restores the last valid colour.
 */
export function ColorField({
  value,
  defaultValue = "#0b6f80",
  onValueChange,
  swatches,
  className,
}: Readonly<ColorFieldProps>) {
  const { t } = useTranslation();
  const [inner, setInner] = useState(defaultValue);
  const [text, setText] = useState<string | null>(null);
  const current = value ?? inner;

  function set(color: string) {
    setInner(color);
    setText(null);
    onValueChange?.(color);
  }

  const preview = HEX.test(text ?? "") ? (text as string) : current;

  return (
    <div data-slot="color-field" className={cn("grid gap-3", className)}>
      <div role="radiogroup" aria-label={t("ui.palette")} className="flex flex-wrap gap-2">
        {swatches.map((swatch) => {
          const on = same(swatch.value, current);
          return (
            <button
              key={swatch.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={swatch.label}
              title={swatch.label}
              onClick={() => set(swatch.value)}
              style={{ "--sw": swatch.value } as CSSProperties}
              className={cn(
                "grid size-8 cursor-pointer place-items-center rounded-sm bg-(--sw) text-white",
                "shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)] transition-[scale,box-shadow] duration-(--duration-fast) ease-(--ease-spring)",
                "hover:scale-[1.08] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
                on && "shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--sw)]",
              )}
            >
              {on && <IconCheck size={14} stroke={2} aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="relative flex max-w-[220px] items-center">
        <span
          aria-hidden="true"
          style={{ "--sw": preview } as CSSProperties}
          className="pointer-events-none absolute left-3 size-5 rounded-[6px] bg-(--sw) shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)]"
        />
        <input
          aria-label={t("ui.colorHex")}
          spellCheck={false}
          value={text ?? current}
          aria-invalid={(text !== null && !HEX.test(text)) || undefined}
          onChange={(e) => {
            const next = e.target.value.trim();
            setText(next);
            if (HEX.test(next)) {
              setInner(next);
              onValueChange?.(next);
            }
          }}
          onBlur={() => setText(null)}
          className={cn(fieldSurface, "pr-12 pl-[42px] font-mono text-sm lowercase")}
        />
        <input
          type="color"
          aria-label={t("ui.customColor")}
          value={/^#[0-9a-f]{6}$/i.test(current) ? current : "#000000"}
          onChange={(e) => set(e.target.value)}
          className="absolute right-1.5 size-8 cursor-pointer rounded-sm border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]! [&::-webkit-color-swatch-wrapper]:p-1.5"
        />
      </div>
    </div>
  );
}
