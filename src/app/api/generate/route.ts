import { discoverDistrict, type BuildingSpec } from "@/lib/discover";
import { getDistrict, DISTRICTS } from "@/lib/london";
import { buildCityscape } from "@/lib/cityscape";
import { buildFoodTile } from "@/lib/foodbuilding";
import {
  putSnapshot,
  getCityscape,
  putCityscape,
  type DistrictSnapshot,
  type SnapshotSpec,
} from "@/lib/store";

/**
 * POST /api/generate
 * Body: { district: string, max?: number, specs?: BuildingSpec[] }
 *
 * For each restaurant: find its real OSM footprint, render the building's
 * extruded massing as a grey whitebox, and feed it to Nano Banana in EDIT mode
 * with a LOOSE prompt — the model uses the massing as a rough size/position
 * guide but is free to embellish into a charming detailed food building (prettier
 * than a rigid repaint). Background removed → placed on the footprint. Regular
 * buildings are the grey city from the cityscape geometry; only restaurants are
 * generated here.
 *
 * Streams NDJSON: start / tile (with `place`) / error / done.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 3;

export async function POST(request: Request) {
  let body: { district?: string; max?: number; specs?: BuildingSpec[] };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const slug = body.district;
  const district = getDistrict(slug);
  if (!district) {
    return Response.json(
      { error: "Missing or unknown district", available: DISTRICTS.map((d) => d.slug) },
      { status: slug ? 404 : 400 },
    );
  }
  const max = body.max ? Math.min(80, Math.max(1, body.max)) : 50;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        const specs = body.specs?.length
          ? body.specs
          : (await discoverDistrict(district.slug, max)).specs;

        let scape = await getCityscape(district.slug);
        if (!scape) {
          scape = await buildCityscape(district);
          await putCityscape(scape);
        }

        send({ kind: "start", slug: district.slug, total: specs.length });

        const built: SnapshotSpec[] = [];
        let next = 0;
        const worker = async () => {
          while (next < specs.length) {
            const spec = specs[next++];
            try {
              const out = await buildFoodTile(district.slug, scape!, spec);
              built.push(out);
              send({
                kind: "tile",
                name: out.name,
                cuisine: out.cuisine,
                tile_url: out.tile_url,
                place: out.place,
              });
            } catch (err) {
              send({
                kind: "error",
                name: spec.name,
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, specs.length) }, worker));

        const snapshot: DistrictSnapshot = {
          slug: district.slug,
          updated_at: new Date().toISOString(),
          specs: built,
          changes: [],
        };
        await putSnapshot(snapshot);
        send({ kind: "done", slug: district.slug, count: built.length, updated_at: snapshot.updated_at });
      } catch (err) {
        send({ kind: "fatal", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
