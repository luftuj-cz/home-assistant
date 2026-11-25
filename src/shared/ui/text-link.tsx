import { IconExternalLink } from "@tabler/icons-react";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE } from "./icon-types";

type TextLinkProps = ComponentProps<"a"> & {
  /** Adds an arrow and opens in a new tab. */
  external?: boolean;
};

/** A text link in `air`, underlined; the underline thickens on hover. */
export function TextLink({ external, className, children, ...props }: TextLinkProps) {
  return (
    <a
      data-slot="text-link"
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={cn(
        "inline-flex items-baseline gap-1 font-medium text-air underline decoration-1 underline-offset-3",
        "transition-[color,text-decoration-thickness] duration-(--duration-fast)",
        "hover:text-[color-mix(in_oklab,var(--air)_80%,var(--foreground))] hover:decoration-2",
        className,
      )}
      {...props}
    >
      {children}
      {external && (
        <IconExternalLink size={14} stroke={ICON_STROKE} className="self-center" aria-hidden />
      )}
    </a>
  );
}
