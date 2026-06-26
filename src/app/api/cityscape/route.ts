import { buildCityscape } from "@/lib/cityscape";
import { getCityscape, putCityscape } from "@/lib/store";
import { getDistrict, DISTRICTS } from "@/lib/london";

/**
 * GET /api/cityscape?district=<slug>[&refresh=1]
 * Real OSM street network + building footprints for the district, projected to
 * iso screen space. Cached in Blob (geometry is ~static) — fetched from Overpass
 * only on a miss or ?refresh=1.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("district");
  const district = getDistrict(slug);
  if (!district) {
    return Response.json(
      { error: "Missing or unknown district", available: DISTRICTS.map((d) => d.slug) },
      { status: slug ? 404 : 400 },
    );
  }

  try {
    // Geometry is ~static (real OSM streets + footprints) — cache hard at the CDN.
    const headers = {
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    };
    if (!url.searchParams.get("refresh")) {
      const cached = await getCityscape(district.slug);
      if (cached) return Response.json(cached, { headers });
    }
    const scape = await buildCityscape(district);
    await putCityscape(scape);
    return Response.json(scape, { headers });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
