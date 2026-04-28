import { NumberInput, type NumberInputProps } from "@mantine/core";

interface NumberFieldProps extends Omit<NumberInputProps, "error"> {
  error?: string | null;
}

export function NumberField({ error, ...rest }: NumberFieldProps) {
  return <NumberInput error={error ?? undefined} {...rest} />;
}
