import { IconX } from "@tabler/icons-react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Drawer as SheetPrimitive } from "vaul";

import { cn } from "@luftuj/shared/utils/cn";

import { Button } from "./button";

/**
 * Bottom sheet for forms and pickers on a phone (vaul): grab handle, 24px top corners, slides up from the bottom
 * edge and can be swiped down to close. A Dialog already turns into a sheet below 560px; use this one when the
 * content is phone-only (pickers, the mobile menu).
 */
function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-[color-mix(in_oklab,var(--foreground)_28%,transparent)] backdrop-blur-[2px]"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "@container fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] w-full grid-rows-[auto_auto_minmax(0,1fr)] gap-4",
          "rounded-t-xl bg-popover px-6 pt-3 pb-[calc(var(--space-6)+env(safe-area-inset-bottom))] font-sans text-sm leading-5",
          "text-popover-foreground shadow-float outline-none",
          className,
        )}
        {...props}
      >
        <div aria-hidden="true" className="h-1 w-10 justify-self-center rounded-[2px] bg-border" />
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

type SheetHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
};

function SheetHeader({ title, description, className, ...props }: SheetHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex items-start justify-between gap-4", className)}
      {...props}
    >
      <div className="grid min-w-0 gap-1">
        <SheetPrimitive.Title className="section-title">{title}</SheetPrimitive.Title>
        {description ? (
          <SheetPrimitive.Description className="body text-muted-foreground">
            {description}
          </SheetPrimitive.Description>
        ) : null}
      </div>
      <SheetPrimitive.Close asChild>
        <Button
          variant="ghost"
          size="icon"
          icon={IconX}
          aria-label={t("ui.close")}
          className="-mt-1 -mr-2"
        />
      </SheetPrimitive.Close>
    </div>
  );
}

function SheetBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        "-mx-6 grid min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto overscroll-contain px-6",
        className,
      )}
      {...props}
    />
  );
}

export { Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTrigger };
