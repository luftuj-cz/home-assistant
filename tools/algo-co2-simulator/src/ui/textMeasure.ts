// Measures text in the page's font with a canvas, so the floor plan can fit labels to small rooms.

const REFERENCE_PX = 100;
// Used only without a 2D canvas; a little wider than the real font, so text still fits.
const FALLBACK_EM_PER_CHAR = 0.6;
// CO2 readings change every frame; the cap keeps the cache bounded over a long run.
const CACHE_LIMIT = 2000;

const cache = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;
let fontFamily = "";

function canvasContext(): CanvasRenderingContext2D | null {
  if (context === undefined) {
    context = document.createElement("canvas").getContext("2d");
    fontFamily = getComputedStyle(document.body).fontFamily;
  }
  return context;
}

/** The width of `text` in em, in the page's font at the given weight. */
export function measureTextEm(text: string, weight: number): number {
  const key = `${weight}|${text}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const ctx = canvasContext();
  let em = text.length * FALLBACK_EM_PER_CHAR;
  if (ctx !== null) {
    ctx.font = `${weight} ${REFERENCE_PX}px ${fontFamily}`;
    em = ctx.measureText(text).width / REFERENCE_PX;
  }
  if (cache.size >= CACHE_LIMIT) {
    cache.clear();
  }
  cache.set(key, em);
  return em;
}
