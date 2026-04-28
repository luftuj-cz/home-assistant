import { Button, Group, Modal, type ModalProps, Stack } from "@mantine/core";
import type { FormEvent, ReactNode } from "react";

interface FormModalProps extends Omit<ModalProps, "children" | "onSubmit"> {
  children: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel?: ReactNode;
  cancelLabel?: ReactNode;
  onCancel?: () => void;
  submitDisabled?: boolean;
  submitting?: boolean;
  footer?: ReactNode;
}

export function FormModal({
  children,
  onSubmit,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  onCancel,
  submitDisabled,
  submitting,
  footer,
  size = "lg",
  centered = true,
  ...rest
}: FormModalProps) {
  const body = (
    <Stack gap="md">
      {children}
      {footer ?? (
        <Group justify="flex-end" gap="sm">
          {onCancel && (
            <Button variant="default" onClick={onCancel} disabled={submitting}>
              {cancelLabel}
            </Button>
          )}
          <Button type="submit" loading={submitting} disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </Group>
      )}
    </Stack>
  );

  return (
    <Modal size={size} centered={centered} {...rest}>
      {onSubmit ? <form onSubmit={onSubmit}>{body}</form> : body}
    </Modal>
  );
}
