import { TextInput, type TextInputProps } from "@mantine/core";

interface TextInputFieldProps extends Omit<TextInputProps, "error"> {
  error?: string | null;
}

export function TextInputField({ error, ...rest }: TextInputFieldProps) {
  return <TextInput error={error ?? undefined} {...rest} />;
}
