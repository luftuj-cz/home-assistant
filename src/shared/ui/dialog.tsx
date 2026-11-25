import { IconX } from "@tabler/icons-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { Button } from "./button";

/** A focused task or confirmation. Below 560px it docks to the bottom as a sheet. */
function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

// z-50 for every overlay (sheet, popover, select, dropdown-menu, tooltip too): above the header and TabBar (z-30).
function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-[color-mix(in_oklab,var(--foreground)_28%,transparent)] backdrop-blur-[2px]",
        "data-[state=open]:animate-fade",
        className,
      )}
      {...props}
    />
  );
}

const SIZE = {
  sm: "min-[561px]:max-w-[420px]",
  md: "min-[561px]:max-w-[540px]",
  lg: "min-[561px]:max-w-[760px]",
};

type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  /** `sm` confirmations and short forms, `md` forms, `lg` the mode editor and group manager. */
  size?: keyof typeof SIZE;
  /** Header and footer stay; a long body scrolls between them. */
  scroll?: boolean;
  /** Colours the legend: `plan` for custom plans, `danger` for destructive dialogs. */
  tone?: "plan" | "danger";
};

function DialogContent({
  className,
  children,
  size = "md",
  scroll = false,
  tone,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-scroll={scroll || undefined}
        data-tone={tone}
        className={cn(
          "group/dialog @container fixed z-50 grid w-full gap-6 bg-popover p-6 font-sans text-sm leading-5 text-popover-foreground shadow-float outline-none",
          // Desktop: centred, pops up 10px with a spring.
          "min-[561px]:top-1/2 min-[561px]:left-1/2 min-[561px]:max-h-[min(860px,calc(100dvh-48px))] min-[561px]:w-[calc(100%-48px)]",
          "min-[561px]:-translate-x-1/2 min-[561px]:-translate-y-1/2 min-[561px]:rounded-xl min-[561px]:data-[state=open]:animate-pop",
          SIZE[size],
          // Phone: a bottom sheet with a grab handle that slides up.
          "max-[560px]:inset-x-0 max-[560px]:bottom-0 max-[560px]:max-h-[92dvh] max-[560px]:grid-rows-[auto_auto_minmax(0,1fr)_auto]",
          "max-[560px]:gap-4 max-[560px]:overflow-hidden max-[560px]:rounded-t-xl max-[560px]:pt-3 max-[560px]:data-[state=open]:animate-sheet-in",
          scroll &&
            "min-[561px]:grid-rows-[auto_minmax(0,1fr)_auto] min-[561px]:gap-0 min-[561px]:overflow-hidden min-[561px]:p-0",
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          className="hidden h-1 w-10 justify-self-center rounded-[2px] bg-border max-[560px]:block"
        />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

type DialogHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  /** Context above the title; takes the dialog's tone. */
  legend?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Hide the close button (e.g. while a save is running). */
  hideClose?: boolean;
};

/** Legend, title and description on the left, the close button on the right. */
function DialogHeader({
  legend,
  title,
  description,
  hideClose,
  className,
  ...props
}: DialogHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex items-start justify-between gap-4",
        "group-data-scroll/dialog:min-[561px]:px-6 group-data-scroll/dialog:min-[561px]:pt-6 group-data-scroll/dialog:min-[561px]:pb-4",
        className,
      )}
      {...props}
    >
      <div className="grid min-w-0 gap-1">
        {legend && (
          <span className="legend group-data-[tone=danger]/dialog:text-destructive group-data-[tone=plan]/dialog:text-plan">
            {legend}
          </span>
        )}
        <DialogPrimitive.Title data-slot="dialog-title" className="section-title">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description
            data-slot="dialog-description"
            className="body text-muted-foreground"
          >
            {description}
          </DialogPrimitive.Description>
        ) : null}
      </div>
      {!hideClose && (
        <DialogPrimitive.Close asChild>
          <Button
            variant="ghost"
            size="icon"
            icon={IconX}
            aria-label={t("ui.close")}
            className="-mt-1 -mr-2"
          />
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

/** The dialog's content. Scrolls when the dialog has `scroll`, and always on a phone. */
function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "grid min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-4",
        "group-data-scroll/dialog:min-[561px]:overflow-y-auto group-data-scroll/dialog:min-[561px]:overscroll-contain group-data-scroll/dialog:min-[561px]:px-6 group-data-scroll/dialog:min-[561px]:pt-2 group-data-scroll/dialog:min-[561px]:pb-6",
        "max-[560px]:-mx-6 max-[560px]:overflow-y-auto max-[560px]:overscroll-contain max-[560px]:px-6 max-[560px]:pb-2",
        className,
      )}
      {...props}
    />
  );
}

type DialogFooterProps = ComponentProps<"div"> & {
  /** A secondary action on the left (desktop) or centred under the row (phone), e.g. "Smazat". */
  start?: ReactNode;
};

/** Ghost "Zrušit" first, then the primary action. On a phone: one row, the primary action widest. */
function DialogFooter({ className, start, children, ...props }: DialogFooterProps) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-wrap items-center justify-end gap-2",
        "group-data-scroll/dialog:min-[561px]:border-t group-data-scroll/dialog:min-[561px]:border-border group-data-scroll/dialog:min-[561px]:bg-[color-mix(in_oklab,var(--popover)_92%,var(--muted))] group-data-scroll/dialog:min-[561px]:px-6 group-data-scroll/dialog:min-[561px]:py-4",
        "max-[560px]:-mx-6 max-[560px]:-mb-6 max-[560px]:items-stretch max-[560px]:border-t max-[560px]:border-border max-[560px]:px-6 max-[560px]:pt-3 max-[560px]:pb-[calc(var(--space-4)+env(safe-area-inset-bottom))]",
        "max-[560px]:[&>[data-slot=button]]:min-w-0 max-[560px]:[&>[data-slot=button]]:flex-[1_1_0] max-[560px]:[&>[data-variant=ghost]]:flex-none",
        className,
      )}
      {...props}
    >
      {start && (
        <div className="mr-auto max-[560px]:order-2 max-[560px]:m-0 max-[560px]:flex max-[560px]:flex-[1_0_100%] max-[560px]:justify-center">
          {start}
        </div>
      )}
      {children}
    </div>
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTrigger,
  type DialogContentProps,
  type DialogHeaderProps,
};
