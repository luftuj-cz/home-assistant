import type { ReactNode } from "react";

/** One showcase block, screenshot-able by `data-showcase`. */
export function Section({
  id,
  title,
  children,
}: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <section id={id} data-showcase={id} className="grid grid-cols-[minmax(0,1fr)] gap-3 p-5">
      <h2 className="legend">{title}</h2>
      {children}
    </section>
  );
}
