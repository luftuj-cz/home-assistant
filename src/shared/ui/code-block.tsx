import type { ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { CopyButton } from "./copy-button";
import { Legend } from "./legend";

interface CodeBlockProps {
  /** Plain text; it is what the copy button copies. */
  children: string;
  label?: ReactNode;
  /** A copy button in the corner (on by default). */
  copy?: boolean;
  /** Scroll beyond this height (px). */
  maxHeight?: number;
  className?: string;
}

/** Preformatted mono text on a muted well, with a copy button. */
export function CodeBlock({
  children,
  label,
  copy = true,
  maxHeight,
  className,
}: Readonly<CodeBlockProps>) {
  return (
    <div
      data-slot="code-block"
      className={cn(
        "relative grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-md bg-muted",
        className,
      )}
    >
      {label ? (
        <div className="flex min-h-9 items-center justify-between gap-2 pt-0.5 pr-1 pl-3.5">
          <Legend>{label}</Legend>
          {copy && <CopyButton value={children} />}
        </div>
      ) : (
        copy && (
          <div className="absolute top-1 right-1">
            <CopyButton value={children} />
          </div>
        )
      )}
      <pre
        tabIndex={0}
        style={{ maxHeight }}
        className={cn(
          "code m-0 overflow-auto px-3.5 pt-2.5 pb-3.5 leading-[18px] break-words whitespace-pre-wrap",
          "focus-visible:-outline-offset-2",
          !label && copy && "pr-11",
        )}
      >
        {children}
      </pre>
    </div>
  );
}
