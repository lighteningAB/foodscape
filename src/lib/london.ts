/**
 * London districts + bounding boxes + grid mapping.
 *
 * Each district is an approximate lat/lng bounding box plus a grid size. A real
 * restaurant's coordinate maps deterministically into a {grid_x, grid_y} cell so
 * the isometric city has a stable layout. North is "up" (row 0 = top).
 */

export interface District {
  slug: string;
  name: string;
  /** Camera/default focus. */
  center: { lat: number; lng: number };
  /** Bounding box the district's grid spans. */
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  /** Grid dimensions (cells). */
  cols: number;
  rows: number;
}

/** Approximate central-London neighbourhoods. Boxes are rough but stable. */
export const DISTRICTS: District[] = [
  {
    slug: "soho",
    name: "Soho",
    center: { lat: 51.5137, lng: -0.1337 },
    bounds: { minLat: 51.5095, maxLat: 51.5175, minLng: -0.1415, maxLng: -0.1285 },
    cols: 8,
    rows: 8,
  },
  {
    slug: "shoreditch",
    name: "Shoreditch",
    center: { lat: 51.5265, lng: -0.0779 },
    bounds: { minLat: 51.5215, maxLat: 51.5315, minLng: -0.0865, maxLng: -0.0700 },
    cols: 8,
    rows: 8,
  },
  {
    slug: "camden",
    name: "Camden Town",
    center: { lat: 51.5390, lng: -0.1426 },
    bounds: { minLat: 51.5340, maxLat: 51.5445, minLng: -0.1510, maxLng: -0.1345 },
    cols: 8,
    rows: 8,
  },
  {
    slug: "mayfair",
    name: "Mayfair",
    center: { lat: 51.5096, lng: -0.1486 },
    bounds: { minLat: 51.5050, maxLat: 51.5145, minLng: -0.1570, maxLng: -0.1410 },
    cols: 8,
    rows: 8,
  },
  {
    slug: "brixton",
    name: "Brixton",
    center: { lat: 51.4613, lng: -0.1156 },
    bounds: { minLat: 51.4560, maxLat: 51.4665, minLng: -0.1240, maxLng: -0.1075 },
    cols: 8,
    rows: 8,
  },
];

export function getDistrict(slug: string | null | undefined): District | undefined {
  if (!slug) return undefined;
  const s = slug.toLowerCase();
  return DISTRICTS.find((d) => d.slug === s || d.name.toLowerCase() === s);
}

/**
 * Map a real coordinate into a grid cell within the district box. Clamped to the
 * grid; points outside the box snap to the nearest edge cell. Row 0 = north.
 */
export function latLngToGrid(
  d: District,
  lat: number,
  lng: number,
): { x: number; y: number } {
  const { bounds, cols, rows } = d;
  const fx = (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);
  const fy = (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat);
  const x = clamp(Math.floor(fx * cols), 0, cols - 1);
  const y = clamp(Math.floor(fy * rows), 0, rows - 1);
  return { x, y };
}

/**
 * Resolve a desired cell to a free one, spiralling outward if occupied. Keeps
 * the city collision-free when two restaurants land in the same cell.
 */
export function claimCell(
  d: District,
  want: { x: number; y: number },
  used: Set<string>,
): { x: number; y: number } {
  const key = (x: number, y: number) => `${x},${y}`;
  if (!used.has(key(want.x, want.y))) {
    used.add(key(want.x, want.y));
    return want;
  }
  for (let radius = 1; radius < Math.max(d.cols, d.rows); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = want.x + dx;
        const y = want.y + dy;
        if (x < 0 || y < 0 || x >= d.cols || y >= d.rows) continue;
        if (!used.has(key(x, y))) {
          used.add(key(x, y));
          return { x, y };
        }
      }
    }
  }
  // Grid full — overlap is unavoidable; reuse the wanted cell.
  return want;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
