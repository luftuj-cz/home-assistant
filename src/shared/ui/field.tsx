import { IconAlertTriangle } from "@tabler/icons-react";
import { useId, useMemo, type ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { FieldContext } from "./field-context";
import { ICON_STROKE } from "./icon-types";

interface FieldProps {
  label?: ReactNode;
  description?: ReactNode;
  /** Replaces the description and marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  /** The control's id, when it sets its own; otherwise Field makes one. */
  htmlFor?: string;
  className?: string;
  /** One control: Input, NumberInput, SelectTrigger, Combobox, MultiSelect, TimeField, DateTimeField… */
  children: ReactNode;
}

/**
 * Label, control, description or error. The control picks up its id, label, description and error state from the
 * Field (`id`, `aria-labelledby`, `aria-describedby`, `aria-invalid`), so every control has a visible, linked label.
 */
export function Field({
  label,
  description,
  error,
  required,
  htmlFor,
  className,
  children,
}: Readonly<FieldProps>) {
  const uid = useId();
  const controlId = htmlFor ?? `${uid}-control`;
  const labelId = label ? `${uid}-label` : undefined;
  const message = error || description;
  const messageId = message ? `${uid}-message` : undefined;
  const value = useMemo(
    () => ({ controlId, labelId, messageId, invalid: Boolean(error) }),
    [controlId, labelId, messageId, error],
  );

  return (
    <FieldContext.Provider value={value}>
      <div data-slot="field" className={cn("grid content-start gap-2", className)}>
        {label && (
          <label id={labelId} htmlFor={controlId} className="label">
            {label}
            {required && (
              <span aria-hidden="true" className="text-destructive">
                {" "}
                *
              </span>
            )}
          </label>
        )}
        {children}
        {error ? (
          <p
            id={messageId}
            role="alert"
            className="flex items-center gap-1.5 text-xs leading-4 font-medium text-destructive"
          >
            <IconAlertTriangle size={14} stroke={ICON_STROKE} className="flex-none" aria-hidden />
            {error}
          </p>
        ) : (
          description && (
            <p id={messageId} className="caption text-muted-foreground">
              {description}
            </p>
          )
        )}
      </div>
    </FieldContext.Provider>
  );
}
