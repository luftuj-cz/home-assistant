import { IconFile, IconUpload } from "@tabler/icons-react";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { Button, type ButtonProps } from "./button";
import { ICON_STROKE, type IconComponent } from "./icon-types";

interface FileButtonProps {
  accept?: string;
  onFile?: (file: File) => void;
  children?: ReactNode;
  variant?: ButtonProps["variant"];
  icon?: IconComponent;
  disabled?: boolean;
  className?: string;
}

/** A button that opens the file dialog, then shows the picked file's name and size. */
export function FileButton({
  accept,
  onFile,
  children,
  variant = "secondary",
  icon = IconUpload,
  disabled,
  className,
}: Readonly<FileButtonProps>) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);

  return (
    <div
      data-slot="file-button"
      className={cn("flex min-w-0 flex-wrap items-center gap-3", className)}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) {
            setFile({ name: picked.name, size: picked.size });
            onFile?.(picked);
          }
          e.target.value = "";
        }}
      />
      <Button
        variant={variant}
        icon={icon}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {children ?? t("ui.chooseFile")}
      </Button>
      {file && (
        <span className="inline-flex h-10 min-w-0 animate-fade items-center gap-2 rounded-md bg-muted px-3 font-sans text-[13px] leading-4 font-medium">
          <IconFile
            size={16}
            stroke={ICON_STROKE}
            className="flex-none text-muted-foreground"
            aria-hidden
          />
          <span className="truncate">{file.name}</span>
          <span className="code flex-none text-muted-foreground">
            {(file.size / 1024).toFixed(1)} KiB
          </span>
        </span>
      )}
    </div>
  );
}
