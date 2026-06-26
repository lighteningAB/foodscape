import "server-only";
import { latLngToGrid, type District } from "@/lib/london";

/**
 * BREADTH source for the food city. Where Tavily surfaces only ~6–10 *named*
 * top spots, OpenStreetMap knows nearly every eatery in a district. This queries
 * Overpass for all amenity=restaurant/cafe/fast_food/pub/bar with a `name` inside
 * the district bbox — typically 50–200 real places, each with a real coordinate
 * (so no per-restaurant geocode needed). Gemini later assigns a dish +
 * food_material per place; Tavily enriches the few it actually covers.
 */

const OVERPASS = "https://overpass-api.de/api/interpreter";
const OVERPASS_MIRROR = "https://overpass.kumi.systems/api/interpreter";
const USER_AGENT = "foodscape-hackathon/0.1 (London food-city demo)";

export interface Eatery {
  name: string;
  /** OSM cuisine tag (first value), or null. e.g. "italian", "thai". */
  cuisine: string | null;
  lat: number;
  lng: number;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Fetch real eateries in a district, nearest-to-centre first, deduped by name.
 * Returns at most `limit`. Empty array on any Overpass failure (caller falls back).
 */
export async function fetchEateries(d: District, limit = 60): Promise<Eatery[]> {
  const { minLat, maxLat, minLng, maxLng } = d.bounds;
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
  const query =
    `[out:json][timeout:25];` +
    `nwr["amenity"~"^(restaurant|cafe|fast_food|pub|bar)$"]["name"](${bbox});` +
    `out center tags;`;

  const elements = await runOverpass(query);

  const seen = new Set<string>();
  const out: Eatery[] = [];
  for (const el of elements) {
    const name = el.tags?.name?.trim();
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name, cuisine: firstCuisine(el.tags?.cuisine), lat, lng });
  }

  // Spread across the whole district (not clustered in the centre) and avoid
  // overlap: bin into the district grid and pick one eatery per cell, round-robin.
  return spreadSelect(out, d, limit);
}

/**
 * Pick up to `limit` eateries spread evenly over the district. Bins them into the
 * district's grid cells, then round-robins one per cell — so the FIRST pass lands
 * a single building in as many distinct cells as possible (district-wide coverage,
 * ~one building per cell = no overlap) before any cell gets a second.
 */
function spreadSelect(eateries: Eatery[], d: District, limit: number): Eatery[] {
  const bins = new Map<string, Eatery[]>();
  for (const e of eateries) {
    const { x, y } = latLngToGrid(d, e.lat, e.lng);
    const k = `${x},${y}`;
    const arr = bins.get(k);
    if (arr) arr.push(e);
    else bins.set(k, [e]);
  }
  // Within each cell, keep the one nearest its cell so placement looks tidy.
  const keys = [...bins.keys()];
  const out: Eatery[] = [];
  let progressed = true;
  while (out.length < limit && progressed) {
    progressed = false;
    for (const k of keys) {
      const arr = bins.get(k)!;
      if (arr.length) {
        out.push(arr.shift()!);
        progressed = true;
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

async function runOverpass(query: string): Promise<OverpassElement[]> {
  for (const url of [OVERPASS, OVERPASS_MIRROR]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { elements?: OverpassElement[] };
      if (json.elements?.length) return json.elements;
    } catch {
      // try the next mirror
    }
  }
  return [];
}

function firstCuisine(v: string | undefined): string | null {
  if (!v) return null;
  return v.split(/[;,]/)[0].trim().replace(/_/g, " ") || null;
}
