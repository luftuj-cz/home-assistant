import { createContext, useContext, type AriaAttributes } from "react";

export interface FieldControlProps {
  id?: string;
  /** For a control without a Field around it. Declared so TypeScript stops dropping it silently. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

interface FieldContextValue {
  controlId: string;
  labelId?: string;
  messageId?: string;
  invalid: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * The props a control needs to be linked to its Field: id (for the label's htmlFor), the label and message ids and
 * the error state. Explicit props on the control win. Outside a Field it returns the props unchanged.
 */
export function useFieldControl(
  props: Omit<FieldControlProps, "aria-invalid"> & {
    "aria-invalid"?: AriaAttributes["aria-invalid"];
    invalid?: boolean;
  },
): FieldControlProps {
  const field = useContext(FieldContext);
  const ariaInvalid = props["aria-invalid"];
  const invalid =
    props.invalid ||
    (ariaInvalid !== undefined && ariaInvalid !== false && ariaInvalid !== "false") ||
    field?.invalid;
  return {
    id: props.id ?? field?.controlId,
    "aria-label": props["aria-label"],
    "aria-labelledby": props["aria-labelledby"] ?? field?.labelId,
    "aria-describedby": props["aria-describedby"] ?? field?.messageId,
    "aria-invalid": invalid ? true : undefined,
  };
}
