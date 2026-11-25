/**
 * Geometry of the LT-DM-A damper module for DamperModule: a small orthographic projection of the round duct, the
 * butterfly blade on a vertical axle and the servo housing on top. Units: the duct's outer radius is 1; projected
 * points are scaled ×100 into SVG user space.
 */

export type V3 = [number, number, number];

const DEG = Math.PI / 180;
const CAM = { yaw: -20 * DEG, pitch: 21 * DEG };
/** Duct outer and inner radius, blade radius, front and back planes (the duct is 0.72 long). */
export const G = { RO: 1, RI: 0.87, RB: 0.85, ZF: 0.36, ZB: -0.36 };

/** 3D → [x, y] in SVG units plus the depth towards the viewer. */
export function proj([x, y, z]: V3): [number, number, number] {
  const cy = Math.cos(CAM.yaw);
  const sy = Math.sin(CAM.yaw);
  const cp = Math.cos(CAM.pitch);
  const sp = Math.sin(CAM.pitch);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  return [x1 * 100, -y2 * 100, z2];
}

function ring(r: number, z: number, n = 72): V3[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI;
    return [r * Math.cos(t), r * Math.sin(t), z];
  });
}

export function pathOf(pts: V3[], close = true) {
  if (pts.length === 0) return "";
  const d = pts
    .map((p, i) => {
      const [x, y] = proj(p);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join("");
  return close ? `${d}Z` : d;
}

function cross(o: number[], a: number[], b: number[]) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Convex hull (monotone chain) of 2D points: the duct's outline. */
function hull(pts: [number, number][]) {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: [number, number][] = [];
  const upper: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  for (const p of sorted.toReversed()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Sutherland–Hodgman against the half-space sign·(z − plane) ≥ 0. */
function clipZ(poly: V3[], plane: number, sign: 1 | -1): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = sign * (a[2] - plane);
    const db = sign * (b[2] - plane);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), plane]);
    }
  }
  return out;
}

function region(p: V3) {
  if (p[2] < G.ZB) return -1;
  return p[2] > G.ZF ? 1 : 0;
}

/** Open polylines of a closed loop that lie in one z-region (−1 behind the duct, 0 inside it, 1 in front). */
function runs(loop: V3[], wanted: number) {
  const n = loop.length;
  const out: string[] = [];
  const start = loop.findIndex((p) => region(p) !== wanted);
  if (start < 0) return [pathOf(loop)];
  let current: V3[] = [];
  for (let k = 1; k <= n; k++) {
    const p = loop[(start + k) % n];
    if (region(p) === wanted) current.push(p);
    else if (current.length) {
      out.push(pathOf(current, false));
      current = [];
    }
  }
  if (current.length) out.push(pathOf(current, false));
  return out;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  return {
    top: [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ] as V3[],
    front: [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ] as V3[],
    side: [
      [x1, y0, z0],
      [x1, y0, z1],
      [x1, y1, z1],
      [x1, y1, z0],
    ] as V3[],
  };
}

const SERVO = box(-0.4, 0.4, 1.1, 1.86, -0.36, 0.36);
const PLATE = box(-0.5, 0.5, 0.94, 1.1, -0.43, 0.43);

function buildStatic() {
  const front = ring(G.RO, G.ZF);
  const back = ring(G.RO, G.ZB);
  const outline = hull(
    [...front, ...back].map((p) => {
      const [x, y] = proj(p);
      return [x, y] as [number, number];
    }),
  );
  const all: V3[] = [
    ...front,
    ...back,
    ...SERVO.top,
    ...SERVO.front,
    ...SERVO.side,
    ...ring(G.RB, 0).map(([x, y]) => [0, y, x] as V3),
    [0.6, -0.6, 1.2],
    [-0.6, 0.6, 1.2],
  ];
  const xs = all.map((p) => proj(p)[0]);
  const ys = all.map((p) => proj(p)[1]);
  const pad = 6;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const origin = proj([0, 1.86, 0]);
  const ux = proj([1, 1.86, 0]);
  const uz = proj([0, 1.86, 1]);
  return {
    viewBox: [x0, y0, Math.max(...xs) + pad - x0, Math.max(...ys) + pad - y0] as const,
    silhouette: `M${outline.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}Z`,
    rimFace: pathOf(ring(G.RO, G.ZF)) + pathOf(ring(G.RI, G.ZF).toReversed()),
    ribs: [0.955, 0.915].map((r) => pathOf(ring(r, G.ZF))),
    frontBore: pathOf(ring(G.RI, G.ZF)),
    backBore: pathOf(ring(G.RI, G.ZB)),
    axle: pathOf(
      [
        [0, -G.RI, 0],
        [0, G.RI, 0],
      ],
      false,
    ),
    servo: { top: pathOf(SERVO.top), front: pathOf(SERVO.front), side: pathOf(SERVO.side) },
    plate: { top: pathOf(PLATE.top), front: pathOf(PLATE.front), side: pathOf(PLATE.side) },
    /** Maps the servo's top face to 2D so "luftuj.cz" lies on it. */
    engrave: `matrix(${(ux[0] - origin[0]) / 100} ${(ux[1] - origin[1]) / 100} ${(uz[0] - origin[0]) / 100} ${(uz[1] - origin[1]) / 100} ${origin[0]} ${origin[1]})`,
  };
}

/** Everything that does not move, computed once. */
export const DAMPER_STATIC = buildStatic();

export interface BladeGeometry {
  back: string;
  mid: string;
  front: string;
  edgeBack: string;
  edgeMid: string;
  edgeFront: string;
  fill: string;
  /** Open area, 1 − sin α: drives the airflow. */
  openness: number;
}

/**
 * The blade at angle `a` (0 = open, along the airflow; 90 = closed), split where the duct hides it: the part behind
 * the duct is seen only through the back opening, the middle only through the front opening, the front part
 * everywhere.
 */
export function bladeGeometry(a: number): BladeGeometry {
  const sa = Math.sin(a * DEG);
  const ca = Math.cos(a * DEG);
  const blade: V3[] = Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * 2 * Math.PI;
    const u = G.RB * Math.cos(t);
    const v = G.RB * Math.sin(t);
    return [-u * sa, v, u * ca];
  });
  // Overlap the parts slightly so no anti-aliasing seam shows where the blade leaves the duct.
  const overlap = 0.02;
  const facing = Math.abs(proj([-ca, 0, -sa])[2]);
  return {
    back: pathOf(clipZ(blade, G.ZB + overlap, -1)),
    mid: pathOf(clipZ(clipZ(blade, G.ZB, 1), G.ZF, -1)),
    front: pathOf(clipZ(blade, G.ZF - overlap, 1)),
    edgeBack: runs(blade, -1).join(""),
    edgeMid: runs(blade, 0).join(""),
    edgeFront: runs(blade, 1).join(""),
    fill: `color-mix(in oklab, var(--damper-blade) ${Math.round(100 - 22 * facing)}%, #ffffff)`,
    openness: 1 - sa,
  };
}

export type DamperState = "open" | "partial" | "closed" | "offline";

/** open / partial / closed from the entity value, or offline. */
export function damperState(
  value: number,
  min: number,
  max: number,
  available = true,
): DamperState {
  if (!available) return "offline";
  if (value <= min) return "open";
  if (value >= max) return "closed";
  return "partial";
}

/** The entity value as the blade angle: min (open) → 0°, max (closed) → 90°. */
export function damperAngle(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return Math.max(0, Math.min(90, ((value - min) / (max - min)) * 90));
}
