import { Switch, type SwitchProps } from "@mantine/core";
import { forwardRef } from "react";

export const MotionSwitch = forwardRef<HTMLInputElement, SwitchProps>((props, ref) => {
  return (
    <div
      style={{
        display: "inline-flex",
        width: "fit-content",
        verticalAlign: "middle",
      }}
    >
      <Switch
        ref={ref}
        {...props}
        styles={{
          thumb: {
            transition: "transform 400ms cubic-bezier(0.68, -0.6, 0.32, 1.6)",
          },
        }}
      />
    </div>
  );
});

MotionSwitch.displayName = "MotionSwitch";
