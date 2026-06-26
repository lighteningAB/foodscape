import "server-only";
import {
  SCALE,
  projector,
  type CityRoad,
  type CityFootprint,
  type CityscapeMeta,
  type Cityscape,
  type Place,
} from "@/lib/cityscape-geom";

/**
 * REAL city geometry for a district: the actual OSM street network + building
 * footprints, projected to 2:1 isometric screen space. This is what makes the
 * map read as a real city (irregular blocks, bent streets) instead of a soulless
 * synthetic grid — the same "structural truth" idea as isometric.nyc, drawn
 * deterministically from OSM rather than via a fragile model.
 *
 * Output is pre-projected to screen pixels so the client renders it directly,
 * plus a `meta` block so the client can project restaurant lat/lng into the SAME
 * space (to place food-building sprites on their real footprints).
 */

export type { Cityscape, CityscapeMeta, CityRoad, CityFootprint, Place };

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

interface OsmWay {
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

function roadWidthM(hw: string): number {
  if (/(motorway|trunk|primary)/.test(hw)) return 14;
  if (/secondary/.test(hw)) return 11;
  if (/tertiary/.test(hw)) return 9;
  if (/(residential|unclassified|living_street)/.test(hw)) return 7;
  if (/(service|pedestrian)/.test(hw)) return 4.5;
  return 0; // footway/path/cycleway → skip
}

async function overpass(query: string): Promise<OsmWay[]> {
  let lastErr: unknown;
  for (const ep of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "foodscape-hackathon/0.1 (London food-city)",
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(60000),
      });
      const text = await res.text();
      if (!res.ok || !text.startsWith("{")) {
        lastErr = new Error(`${ep} → ${res.status} non-JSON`);
        continue;
      }
      const json = JSON.parse(text) as { elements?: OsmWay[] };
      return (json.elements ?? []).filter((w) => w.geometry && w.geometry.length > 1);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`all Overpass mirrors failed: ${lastErr}`);
}

/** Fetch + project the real OSM cityscape for a district. */
export async function buildCityscape(d: {
  slug: string;
  center: { lat: number; lng: number };
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}): Promise<Cityscape> {
  const { minLat, maxLat, minLng, maxLng } = d.bounds;
  const query =
    `[out:json][timeout:60];(` +
    `way["highway"](${minLat},${minLng},${maxLat},${maxLng});` +
    `way["building"](${minLat},${minLng},${maxLat},${maxLng});` +
    `);out geom;`;
  const ways = await overpass(query);

  const proj = projector(d.center.lat, d.center.lng);
  const roadsRaw = ways.filter((w) => w.tags?.highway);
  const buildingsRaw = ways.filter((w) => w.tags?.building && w.geometry!.length > 2);

  // First pass: project everything to find screen bounds.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const note = ([x, y]: [number, number]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const w of [...roadsRaw, ...buildingsRaw])
    for (const p of w.geometry!) note(proj(p.lat, p.lon));

  const pad = 48;
  const originX = minX - pad;
  const originY = minY - pad;
  const meta: CityscapeMeta = {
    centerLat: d.center.lat,
    centerLng: d.center.lng,
    scale: SCALE,
    originX,
    originY,
    width: Math.ceil(maxX - minX) + pad * 2,
    height: Math.ceil(maxY - minY) + pad * 2,
  };
  const shift = (p: { lat: number; lon: number }): [number, number] => {
    const [x, y] = proj(p.lat, p.lon);
    return [Math.round((x - originX) * 10) / 10, Math.round((y - originY) * 10) / 10];
  };

  const roads: CityRoad[] = [];
  for (const r of roadsRaw) {
    const w = roadWidthM(r.tags!.highway);
    if (w <= 0) continue;
    roads.push({ pts: r.geometry!.map(shift), w: Math.max(2, w * SCALE * 0.7) });
  }
  // Widest roads first so they sit under narrower ones at junctions.
  roads.sort((a, b) => b.w - a.w);

  const buildings: CityFootprint[] = buildingsRaw.map((b) => {
    const t = b.tags ?? {};
    const levels = parseFloat(t["building:levels"]);
    const heightM = parseFloat(t["height"]);
    const storeys = Number.isFinite(levels)
      ? levels
      : Number.isFinite(heightM)
        ? heightM / 3.2
        : 4; // sensible central-London default
    // Vertical iso px per metre, slightly exaggerated for readable massing.
    const h = Math.max(6, storeys * 3.2 * SCALE * 1.15);
    // Stable per-building tone jitter from the osm id (no Math.random in libs).
    const tone = ((b.geometry![0].lat * 1e5 + b.geometry![0].lon * 1e5) % 100) / 100;
    return { pts: b.geometry!.map(shift), h: Math.round(h), tone: Math.abs(tone) };
  });

  return { slug: d.slug, meta, roads, buildings };
}
