import "server-only";
import sharp from "sharp";
import type { Cityscape, CityFootprint, Place } from "@/lib/cityscape-geom";

/**
 * Render a real building's extruded massing as a grey isometric "whitebox" PNG,
 * to feed into Nano Banana edit mode: the model repaints the building in food.
 * The edit prompt decides how tightly the silhouette is kept — we use a LOOSE
 * prompt so the model embellishes into a charming building while staying roughly
 * the real footprint + height. Returns the `Place` so the client drops the food
 * sprite over the real footprint.
 */

type Pt = [number, number];

function pointInPoly(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function centroid(pts: Pt[]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  return [sx / pts.length, sy / pts.length];
}

function polyArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(a / 2);
}

/**
 * Match a restaurant point to its real building footprint. Prefer the SMALLEST
 * footprint that CONTAINS the point — a restaurant sits in a specific small
 * building, not the big block/market polygon it may also fall inside (which
 * produced oversized food buildings). Fall back to the nearest small footprint.
 */
export function matchFootprint(scape: Cityscape, x: number, y: number): number {
  let containIdx = -1;
  let containArea = Infinity;
  let nearIdx = -1;
  let nearD = Infinity;
  for (let i = 0; i < scape.buildings.length; i++) {
    const pts = scape.buildings[i].pts as Pt[];
    if (pointInPoly(pts, x, y)) {
      const a = polyArea(pts);
      if (a < containArea) {
        containArea = a;
        containIdx = i;
      }
    }
    const [cx, cy] = centroid(pts);
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < nearD) {
      nearD = d;
      nearIdx = i;
    }
  }
  return containIdx >= 0 ? containIdx : nearIdx;
}

const RENDER_MAX = 512;

/** Render the extruded massing whitebox + the placement box (cityscape coords). */
export async function renderMassing(
  fp: CityFootprint,
): Promise<{ png: Buffer; place: Omit<Place, "cx" | "cy"> }> {
  const base = fp.pts as Pt[];
  const h = fp.h;
  const roof: Pt[] = base.map(([x, y]) => [x, y - h]);

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of [...base, ...roof]) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const wWorld = x1 - x0 || 1;
  const hWorld = y1 - y0 || 1;
  const scale = RENDER_MAX / Math.max(wWorld, hWorld);
  const W = Math.max(8, Math.round(wWorld * scale));
  const H = Math.max(8, Math.round(hWorld * scale));
  const tx = (x: number) => ((x - x0) * scale).toFixed(1);
  const ty = (y: number) => ((y - y0) * scale).toFixed(1);

  const [cx, cy] = centroid(base);
  const faces: string[] = [];
  for (let i = 0; i < base.length; i++) {
    const a = base[i];
    const b = base[(i + 1) % base.length];
    const ar = roof[i];
    const br = roof[(i + 1) % base.length];
    let nx = b[1] - a[1];
    let ny = -(b[0] - a[0]);
    if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (ny <= 0) continue;
    faces.push(
      `<polygon points="${tx(a[0])},${ty(a[1])} ${tx(b[0])},${ty(b[1])} ${tx(br[0])},${ty(br[1])} ${tx(ar[0])},${ty(ar[1])}" fill="${nx >= 0 ? "#9a9a9a" : "#6f6f6f"}"/>`,
    );
  }
  const roofPts = roof.map((p) => `${tx(p[0])},${ty(p[1])}`).join(" ");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>` +
    faces.join("") +
    `<polygon points="${roofPts}" fill="#cfcfcf" stroke="#555" stroke-width="1"/></svg>`;

  return {
    png: await sharp(Buffer.from(svg)).png().toBuffer(),
    place: { x: x0, y: y0, w: wWorld, h: hWorld },
  };
}
