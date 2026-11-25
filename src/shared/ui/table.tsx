import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

type TableProps = ComponentProps<"table"> & {
  /** 8px cell padding instead of 12px, for long debug lists. */
  dense?: boolean;
};

/** Debug tables (values, registers, entities). Headers read as legends; put numbers right-aligned in mono. */
function Table({ className, dense, ...props }: TableProps) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-auto rounded-lg bg-card shadow-plane"
    >
      <table
        data-slot="table"
        data-dense={dense || undefined}
        className={cn("group/table w-full border-collapse font-sans text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />;
}

function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

function TableFooter({ className, ...props }: ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t border-border bg-muted font-medium", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border last:border-b-0 in-data-[slot=table-body]:hover:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        // The legend style, without its `display: block` (that would take the cell out of the table layout).
        "px-4 pt-3.5 pb-2.5 text-left align-bottom font-mono text-[11px] leading-[14px] font-medium tracking-[.08em] whitespace-nowrap text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-4 py-3 align-middle group-data-dense/table:py-2 [&.font-mono]:text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("caption mt-3 text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
