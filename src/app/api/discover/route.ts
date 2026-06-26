import { discoverDistrict } from "@/lib/discover";
import { DISTRICTS } from "@/lib/london";

// External live data (Tavily/OSM) + per-request work — never cache.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/discover?district=soho[&max=8]
 * District in → array of building specs out (real restaurants + real building
 * form + tiling food spec + grid cell). No image generation (that's Phase 3).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("district");
  const maxParam = searchParams.get("max");
  const max = maxParam ? Math.min(20, Math.max(1, parseInt(maxParam, 10))) : 8;

  if (!slug) {
    return Response.json(
      {
        error: "Missing ?district=",
        available: DISTRICTS.map((d) => d.slug),
      },
      { status: 400 },
    );
  }

  try {
    const result = await discoverDistrict(slug, max);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("Unknown district") ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
