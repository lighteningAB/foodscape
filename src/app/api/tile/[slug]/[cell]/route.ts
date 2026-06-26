import { getTile } from "@/lib/store";

/**
 * PRIVATE-store tile proxy.
 *
 * GET /api/tile/<slug>/<x>-<y>  → streams tiles/<slug>/<x>-<y>.png from the
 * private Blob store, fetched server-side with the read-write token. This is the
 * URL the browser <img> tags use; the blob itself is never publicly fetchable.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ slug: string; cell: string }> },
) {
  const { slug, cell } = await ctx.params;

  // cell is "<x>-<y>" (matches tilePath / tileProxyUrl).
  const m = /^(\d+)-(\d+)$/.exec(cell);
  if (!m) {
    return new Response("Bad cell", { status: 400 });
  }
  const x = parseInt(m[1], 10);
  const y = parseInt(m[2], 10);

  try {
    const tile = await getTile(slug, x, y);
    if (!tile) {
      return new Response("Tile not found", { status: 404 });
    }
    return new Response(tile.stream, {
      headers: {
        "Content-Type": tile.contentType,
        // Tiles are large PNGs and change rarely (only when the daily agent
        // regenerates a cell). Let the Vercel CDN cache them so reloads hit the
        // edge, not this proxy + Blob round-trip. stale-while-revalidate serves
        // an instant (possibly 1-build-old) tile while refreshing in the
        // background — a brief staleness window is fine for a living map.
        "Cache-Control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(message, { status: 500 });
  }
}
