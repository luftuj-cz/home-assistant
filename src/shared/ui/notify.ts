import { createElement, type ReactNode } from "react";
import { toast } from "sonner";

import { Toast, type ToastVariant } from "./sonner";

/**
 * What a notification is about. Colour follows from it, never the other way round:
 * `plan` is reserved for Vlastní plán, `neutral` is a plain notice.
 */
export type NotifyVariant = "success" | "error" | "warning" | "info" | "plan" | "neutral";

export interface NotifyOptions {
  /** Lets a later call replace or dismiss this notification. */
  id?: string;
  title?: ReactNode;
  message: ReactNode;
  /** Omitted: `info`. */
  variant?: NotifyVariant;
  /** Milliseconds before it closes; `false` keeps it until dismissed. Errors stay by default. */
  autoClose?: number | false;
  /** Shows a spinner in place of the colour mark, for work still in progress. */
  loading?: boolean;
  /** `false` hides the close button. */
  dismissible?: boolean;
}

const TOAST_VARIANT: Record<NotifyVariant, ToastVariant> = {
  success: "success",
  error: "destructive",
  warning: "warning",
  info: "info",
  plan: "plan",
  neutral: "neutral",
};

const DEFAULT_DURATION = 5000;

/** Shows a toast (sonner, styled as the design system's Toast). Returns its id. */
export function notify({
  id,
  title,
  message,
  variant = "info",
  autoClose,
  loading,
  dismissible = true,
}: NotifyOptions): string | number {
  const duration =
    autoClose === false || (autoClose === undefined && variant === "error")
      ? Number.POSITIVE_INFINITY
      : (autoClose ?? DEFAULT_DURATION);

  return toast.custom(
    (toastId) =>
      createElement(Toast, {
        variant: TOAST_VARIANT[variant],
        // Without a title the message is the title, so a toast always has one line in the label style.
        title: title ?? message,
        description: title ? message : undefined,
        loading,
        dismissible,
        onClose: () => toast.dismiss(toastId),
      }),
    { id, duration, dismissible },
  );
}

export function dismissNotification(id: string) {
  toast.dismiss(id);
}
