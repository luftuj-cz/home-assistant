import type { SVGProps } from "react";

/*
 * LUFTaTOR's own glyphs, for the concepts Tabler has no icon for (design system: Iconography). Same contract as a
 * Tabler icon (`size`, `stroke`, currentColor), so they fit every `icon` prop.
 */

type GlyphProps = Omit<SVGProps<SVGSVGElement>, "stroke"> & {
  size?: number | string;
  stroke?: number | string;
};

function StrokeGlyph({ size = 24, stroke = 1.5, d, ...props }: GlyphProps & { d: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-label"] ? undefined : true}
      {...props}
    >
      <path d={d} />
    </svg>
  );
}

/** Klapky: the damper in front view (servo block, ring, blade). Replaces IconDeviceFloppy, which read as "save". */
export function IconDamper(props: GlyphProps) {
  return (
    <StrokeGlyph
      d="M9.5 2.5h5v3h-5zM12 6.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM12 9c1.3 0 2 2.2 2 5s-.7 5-2 5-2-2.2-2-5 .7-5 2-5z"
      {...props}
    />
  );
}

/**
 * Modbus TCP: a client box feeding an RS-485-style bus with three devices. Drawn for LUFTaTOR; not the Modbus
 * Organization's logo, which must not be redrawn.
 */
export function IconModbus(props: GlyphProps) {
  return (
    <StrokeGlyph
      d="M9.5 3h5a1 1 0 011 1v3a1 1 0 01-1 1h-5a1 1 0 01-1-1V4a1 1 0 011-1zM12 8v4M3.5 12h17M2 10.5v3M22 10.5v3M5 12v3.5M12 12v3.5M19 12v3.5M5 15.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM12 15.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM19 15.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z"
      {...props}
    />
  );
}

/**
 * MQTT: monochrome derivative of the official mqtt.org icon (mqtt/mqttorg-graphics), which its terms permit. Show
 * support, never endorsement. A filled mark, so `stroke` is ignored.
 */
export function IconMqtt({ size = 24, stroke: _stroke, ...props }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 320 320"
      fill="currentColor"
      aria-hidden={props["aria-label"] ? undefined : true}
      {...props}
    >
      <g transform="translate(32 32) scale(0.8)">
        <path d="M7.1,180.6v117.1c0,8.4,6.8,15.3,15.3,15.3H142C141,239.8,80.9,180.7,7.1,180.6zM7.1,84.1v49.8c99,0.9,179.4,80.7,180.4,179.1h51.7C238.2,186.6,134.5,84.2,7.1,84.1zM312.9,297.6V193.5C278.1,107.2,207.3,38.9,119,7.1H22.4c-8.4,0-15.3,6.8-15.3,15.3v15c152.6,0.9,276.6,124,277.6,275.6h13C306.1,312.9,312.9,306.1,312.9,297.6zM272.6,49.8c14.5,14.4,28.6,31.7,40.4,47.8V22.4c0-8.4-6.8-15.3-15.3-15.3h-77.3C238.4,19.7,256.6,33.9,272.6,49.8z" />
      </g>
    </svg>
  );
}
