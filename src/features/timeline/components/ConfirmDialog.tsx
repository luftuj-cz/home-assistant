import { IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@luftuj/shared/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@luftuj/shared/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/** A short destructive confirmation: what will go, then Zrušit and a red action. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: Readonly<ConfirmDialogProps>) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent size="sm" tone="danger">
        <DialogHeader title={title} />
        <DialogBody>
          <p className="body">{children}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button variant="destructive" icon={IconTrash} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
