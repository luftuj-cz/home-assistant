import { Slider } from "@mantine/core";

export interface ValveSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  color: string;
  inverted?: boolean;
  label?: ((value: number) => React.ReactNode) | null;
  marks?: { value: number; label?: React.ReactNode }[];
  size?: "sm" | "md" | "lg" | "xl" | (string & {});
  thumbSize?: number | string;
  onChange?: (value: number) => void;
  onChangeEnd?: (value: number) => void;
}

export function ValveSlider({
  value,
  min,
  max,
  step,
  disabled = false,
  color,
  inverted = true,
  label,
  marks,
  size = "xl",
  thumbSize = 28,
  onChange,
  onChangeEnd,
}: ValveSliderProps) {
  return (
    <Slider
      value={value}
      min={min}
      max={max}
      step={step}
      label={label}
      onChange={onChange}
      onChangeEnd={onChangeEnd}
      inverted={inverted}
      disabled={disabled}
      size={size}
      color={color}
      thumbSize={thumbSize}
      marks={marks}
      styles={{
        root: { width: "100%" },
        track: {
          backgroundColor: disabled
            ? "var(--mantine-color-gray-3)"
            : "var(--mantine-color-blue-1)",
          opacity: disabled ? 0.6 : 1,
        },
        thumb: {
          backgroundColor: disabled
            ? "var(--mantine-color-gray-2)"
            : "var(--mantine-color-white)",
          borderWidth: 2,
          borderColor: disabled
            ? "var(--mantine-color-gray-5)"
            : "var(--mantine-color-blue-6)",
          boxShadow: "var(--mantine-shadow-sm)",
          transition: "border-color 0.2s ease, transform 0.1s ease",
        },
      }}
    />
  );
}