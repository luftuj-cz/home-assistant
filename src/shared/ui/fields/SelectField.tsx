import { Select, type SelectProps } from "@mantine/core";

interface SelectFieldProps extends Omit<SelectProps, "error"> {
  error?: string | null;
}

export function SelectField({ error, ...rest }: SelectFieldProps) {
  return <Select error={error ?? undefined} {...rest} />;
}
