import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { useFieldControl } from "./field-context";
import { ICON_STROKE } from "./icon-types";

/**
 * The field look shared by Input, Select and the pickers: a muted well with a hairline inset that turns `input`
 * on hover and a 2px ring on focus. 44px tall for touch; 16px text on touch so iOS does not zoom.
 */
const fieldSurface = [
  "h-11 w-full rounded-md bg-muted px-3.5 font-sans text-[15px] leading-5 text-foreground",
  "shadow-[inset_0_0_0_1px_var(--border)] outline-none",
  "transition-[box-shadow,background-color] duration-(--duration-fast)",
  "placeholder:text-muted-foreground",
  "hover:shadow-[inset_0_0_0_1px_var(--input)]",
  "focus-visible:bg-card focus-visible:shadow-[inset_0_0_0_2px_var(--ring)] focus-visible:outline-none",
  "aria-invalid:shadow-[inset_0_0_0_2px_var(--destructive)]",
  "disabled:cursor-not-allowed disabled:opacity-55",
  "pointer-coarse:text-base",
].join(" ");

type InputProps = ComponentProps<"input"> & {
  invalid?: boolean;
  /** A unit shown inside the field on the right ("°C", "m³/h"). */
  unit?: string;
};

/**
 * Text, address, host or password. `type="password"` adds a reveal button. Identifiers and addresses go in mono:
 * `className="font-mono"`.
 */
function Input({ className, type, invalid, unit, ...props }: InputProps) {
  const { t } = useTranslation();
  const field = useFieldControl({ ...props, invalid });
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";

  const input = (
    <input
      data-slot="input"
      type={isPassword && shown ? "text" : type}
      className={cn(
        fieldSurface,
        (unit || isPassword) && "pr-[52px]",
        className?.includes("font-mono") && "text-sm",
        className,
      )}
      {...props}
      {...field}
    />
  );

  if (isPassword) {
    return (
      <div className="relative">
        {input}
        <button
          type="button"
          aria-label={shown ? t("ui.hidePassword") : t("ui.showPassword")}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
          className="absolute top-1.5 right-1.5 grid size-8 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {shown ? (
            <IconEyeOff size={18} stroke={ICON_STROKE} aria-hidden />
          ) : (
            <IconEye size={18} stroke={ICON_STROKE} aria-hidden />
          )}
        </button>
      </div>
    );
  }

  if (unit) {
    return (
      <div className="relative">
        {input}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-3 right-3.5 font-mono text-[13px] leading-5 text-muted-foreground"
        >
          {unit}
        </span>
      </div>
    );
  }

  return input;
}

export { Input, fieldSurface, type InputProps };
