import { IconSearch, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE } from "./icon-types";
import { fieldSurface } from "./input";

interface SearchInputProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (text: string) => void;
  placeholder?: string;
  /** Defaults to the placeholder. */
  "aria-label"?: string;
  className?: string;
}

/** Filters as you type (no submit). 40px tall, so it lines up with chips and a ToggleGroup in one bar. */
export function SearchInput({
  value,
  defaultValue = "",
  onValueChange,
  placeholder,
  "aria-label": ariaLabel,
  className,
}: Readonly<SearchInputProps>) {
  const { t } = useTranslation();
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;

  function set(next: string) {
    setInner(next);
    onValueChange?.(next);
  }

  return (
    <div data-slot="search-input" className={cn("relative min-w-0 flex-[1_1_220px]", className)}>
      <IconSearch
        size={16}
        stroke={ICON_STROKE}
        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={current}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => set(e.target.value)}
        className={cn(
          fieldSurface,
          "h-10 pr-9 pl-10 text-sm [&::-webkit-search-cancel-button]:hidden pointer-coarse:text-base",
        )}
      />
      {current && (
        <button
          type="button"
          aria-label={t("ui.clearSearch")}
          onClick={() => set("")}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconX size={14} stroke={ICON_STROKE} aria-hidden />
        </button>
      )}
    </div>
  );
}
