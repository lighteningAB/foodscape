/**
 * RISK PROBE 3 — does real OSM geometry, projected to iso, read as the actual
 * city (vs the soulless synthetic grid)? Fetch a district's roads + building
 * footprints from Overpass, project lat/lng → 2:1 isometric screen space, render
 * the GROUND only (streets + parcels) to an SVG→PNG. No food sprites yet.
 *
 * Run: node --conditions=react-server --env-file=.env.local --import tsx scripts/proto-osm-city.ts [slug]
 * Output: /tmp/osm-city.png
 */
import { getDistrict } from "@/lib/london";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

interface Way {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

async function overpass(query: string): Promise<Way[]> {
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
        console.log(`  ${ep} → ${res.status}, not JSON, trying next`);
        continue;
      }
      const json = JSON.parse(text) as { elements?: Way[] };
      return (json.elements ?? []).filter((w) => w.geometry && w.geometry.length > 1);
    } catch (e) {
      console.log(`  ${ep} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error("all Overpass mirrors failed");
}

// Road stroke width (metres) by highway class — gives street hierarchy.
function roadWidthM(hw: string): number {
  if (/(motorway|trunk|primary)/.test(hw)) return 14;
  if (/secondary/.test(hw)) return 11;
  if (/tertiary/.test(hw)) return 9;
  if (/(residential|unclassified|living_street)/.test(hw)) return 7;
  if (/(service|pedestrian)/.test(hw)) return 4.5;
  return 0; // footway/path/cycleway etc → skip
}

async function main() {
  const slug = process.argv[2] ?? "soho";
  const d = getDistrict(slug);
  if (!d) throw new Error(`unknown district ${slug}`);
  const { minLat, maxLat, minLng, maxLng } = d.bounds;

  const query =
    `[out:json][timeout:60];(` +
    `way["highway"](${minLat},${minLng},${maxLat},${maxLng});` +
    `way["building"](${minLat},${minLng},${maxLat},${maxLng});` +
    `);out geom;`;
  console.log("fetching Overpass…");
  const ways = await overpass(query);
  const roads = ways.filter((w) => w.tags?.highway);
  const buildings = ways.filter((w) => w.tags?.building && w.geometry!.length > 2);
  console.log(`roads=${roads.length} buildings=${buildings.length}`);

  // lat/lng → local metres around the district centre.
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((d.center.lat * Math.PI) / 180);
  const toWorld = (lat: number, lng: number) => ({
    wx: (lng - d.center.lng) * mLng,
    wy: -(lat - d.center.lat) * mLat, // south = +y (screen down)
  });
  // 2:1 isometric.
  const S = 1.4;
  const iso = (wx: number, wy: number) => ({ sx: (wx - wy) * S, sy: (wx + wy) * S * 0.5 });
  const project = (lat: number, lng: number) => {
    const { wx, wy } = toWorld(lat, lng);
    return iso(wx, wy);
  };

  // Compute screen bounds for the SVG canvas.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of ways)
    for (const p of w.geometry!) {
      const { sx, sy } = project(p.lat, p.lon);
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
  const pad = 40;
  const W = Math.ceil(maxX - minX) + pad * 2;
  const H = Math.ceil(maxY - minY) + pad * 2;
  const pt = (lat: number, lng: number) => {
    const { sx, sy } = project(lat, lng);
    return `${(sx - minX + pad).toFixed(1)},${(sy - minY + pad).toFixed(1)}`;
  };

  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#15171c"/>`);
  // Building parcels (under roads so streets sit on top at junctions).
  for (const b of buildings) {
    const pts = b.geometry!.map((p) => pt(p.lat, p.lon)).join(" ");
    parts.push(`<polygon points="${pts}" fill="#c9b79c" stroke="#9c8a6a" stroke-width="1"/>`);
  }
  // Roads, widest first.
  const sorted = roads
    .map((r) => ({ r, w: roadWidthM(r.tags!.highway) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w);
  for (const { r, w } of sorted) {
    const pts = r.geometry!.map((p) => pt(p.lat, p.lon)).join(" ");
    // Width in metres → iso px (roughly S along the squashed axis).
    const px = Math.max(2, w * S * 0.7);
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="#3a3d45" stroke-width="${px.toFixed(1)}" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
  await writeFile("/tmp/osm-city.svg", svg);
  await writeFile("/tmp/osm-city.png", await sharp(Buffer.from(svg)).png().toBuffer());
  console.log(`wrote /tmp/osm-city.png (${W}x${H})`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
