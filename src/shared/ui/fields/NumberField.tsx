import { NumberInput, type NumberInputProps } from "@mantine/core";

interface NumberFieldProps extends Omit<NumberInputProps, "error"> {
  error?: string | null;
}

export function NumberField({ error, ...rest }: Readonly<NumberFieldProps>) {
  return <NumberInput error={error ?? undefined} {...rest} />;
}
