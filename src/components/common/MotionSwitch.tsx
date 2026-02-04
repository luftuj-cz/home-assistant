import { Switch, type SwitchProps } from "@mantine/core";
import { motion } from "framer-motion";
import { forwardRef } from "react";

export const MotionSwitch = forwardRef<HTMLInputElement, SwitchProps>((props, ref) => {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      initial={false}
      animate={{
        scale: props.checked ? 1.03 : 1,
      }}
      transition={{
        type: "spring",
        stiffness: 500,
        damping: 15,
        bounce: 0.6,
      }}
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
    </motion.div>
  );
});

MotionSwitch.displayName = "MotionSwitch";
