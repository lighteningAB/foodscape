import "server-only";

/**
 * THE FORM-LOCK SOURCE.
 *
 * Derives the REAL building at a coordinate from OpenStreetMap (no API key):
 *   - geocode(address)        → lat/lng via Nominatim
 *   - realBuildingForm(lat,lng) → footprint + storeys + roof via Overpass
 *
 * `realForm` is a plain-English descriptor fed straight into
 * `buildBuildingPrompt` (style-anchor.ts) so the food tile keeps the actual
 * building's massing, storey count, roofline, and footprint silhouette.
 *
 * Both services are public + rate-limited. Nominatim usage policy: max ~1 req/s
 * and a real User-Agent. Callers should serialise + throttle.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";
// Nominatim requires an identifying UA; bare fetch UAs get blocked.
const USER_AGENT = "foodscape-hackathon/0.1 (London food-city demo)";

export interface RealBuilding {
  /** Descriptor for buildBuildingPrompt — the form to keep recognizable. */
  realForm: string;
  storeys: number | null;
  heightM: number | null;
  buildingType: string | null;
  roof: string | null;
  footprint: { widthM: number; depthM: number } | null;
  /** Whether an actual OSM building polygon was matched (vs. a generic fallback). */
  matched: boolean;
  osmId: number | null;
}

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

/** Geocode a free-text address to a coordinate. UK-biased. */
export async function geocode(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const url =
    `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=gb&q=` +
    encodeURIComponent(address);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-GB" },
  });
  if (!res.ok) return null;
  const hits = (await res.json()) as Array<{ lat: string; lon: string }>;
  const hit = hits[0];
  if (!hit) return null;
  return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
}

/**
 * Resolve the real building nearest a coordinate into a form descriptor. Falls
 * back to a generic London descriptor if no polygon is tagged within range.
 */
export async function realBuildingForm(
  lat: number,
  lng: number,
): Promise<RealBuilding> {
  const query =
    `[out:json][timeout:25];` +
    `way(around:35,${lat},${lng})["building"];` +
    `out tags geom;`;

  let ways: OverpassWay[] = [];
  try {
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "data=" + encodeURIComponent(query),
    });
    if (res.ok) {
      const json = (await res.json()) as { elements?: OverpassWay[] };
      ways = (json.elements ?? []).filter(
        (e) => e.type === "way" && e.geometry && e.geometry.length > 2,
      );
    }
  } catch {
    // network/Overpass hiccup — fall through to generic.
  }

  const building = pickNearest(ways, lat, lng);
  if (!building) return generic(lat, lng);

  const tags = building.tags ?? {};
  const storeys = parseStoreys(tags);
  const heightM = parseFloatTag(tags["height"]);
  const buildingType = normalizeType(tags["building"]);
  const roof = tags["roof:shape"] ?? null;
  const footprint = footprintMeters(building.geometry!, lat);

  return {
    realForm: describe(storeys, heightM, buildingType, roof, footprint),
    storeys,
    heightM,
    buildingType,
    roof,
    footprint,
    matched: true,
    osmId: building.id,
  };
}

function generic(_lat: number, _lng: number): RealBuilding {
  return {
    realForm:
      "a typical 3-to-4-storey London building, brick, rectangular footprint, flat parapet roof, shopfront at ground level",
    storeys: 3,
    heightM: null,
    buildingType: null,
    roof: null,
    footprint: null,
    matched: false,
    osmId: null,
  };
}

/** Closest building by centroid distance to the target point. */
function pickNearest(
  ways: OverpassWay[],
  lat: number,
  lng: number,
): OverpassWay | null {
  let best: OverpassWay | null = null;
  let bestD = Infinity;
  for (const w of ways) {
    const g = w.geometry!;
    const cLat = g.reduce((s, p) => s + p.lat, 0) / g.length;
    const cLng = g.reduce((s, p) => s + p.lon, 0) / g.length;
    const d = (cLat - lat) ** 2 + (cLng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

function parseStoreys(tags: Record<string, string>): number | null {
  const lv = parseFloatTag(tags["building:levels"]);
  if (lv != null) return Math.round(lv);
  const h = parseFloatTag(tags["height"]);
  if (h != null) return Math.max(1, Math.round(h / 3.2)); // ~3.2 m per storey
  return null;
}

function parseFloatTag(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** OSM building=* value → readable noun. */
function normalizeType(v: string | undefined): string | null {
  if (!v || v === "yes") return null;
  return v.replace(/_/g, " ");
}

/** Bounding-box dimensions of a polygon in metres. */
function footprintMeters(
  geom: Array<{ lat: number; lon: number }>,
  refLat: number,
): { widthM: number; depthM: number } {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of geom) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLng) minLng = p.lon;
    if (p.lon > maxLng) maxLng = p.lon;
  }
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((refLat * Math.PI) / 180);
  return {
    widthM: Math.round((maxLng - minLng) * mPerDegLng),
    depthM: Math.round((maxLat - minLat) * mPerDegLat),
  };
}

function describe(
  storeys: number | null,
  heightM: number | null,
  buildingType: string | null,
  roof: string | null,
  footprint: { widthM: number; depthM: number } | null,
): string {
  const parts: string[] = [];
  const storeyWord = storeys ? `a ${storeys}-storey` : "a multi-storey";
  parts.push(`${storeyWord} ${buildingType ?? "building"}`);
  if (footprint && footprint.widthM > 0 && footprint.depthM > 0) {
    parts.push(`rectangular footprint about ${footprint.widthM}m × ${footprint.depthM}m`);
  }
  if (roof) {
    parts.push(`${roof} roof`);
  } else {
    parts.push("flat parapet roof");
  }
  if (heightM) parts.push(`roughly ${Math.round(heightM)}m tall`);
  return parts.join(", ");
}
