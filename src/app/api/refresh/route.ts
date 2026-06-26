import { refreshDistrict } from "@/lib/agent";
import { getDistrict, DISTRICTS } from "@/lib/london";
import { env } from "@/lib/env";

/**
 * POST /api/refresh   body { district }
 * GET  /api/refresh?district=<slug>   (Vercel Cron sends GET)
 *
 * The autonomous agent: re-discovers a district, diffs against the stored
 * snapshot, regenerates only changed/added tiles, drops removed, and writes the
 * new snapshot + changes[] to Blob. Returns the diff summary.
 *
 * Guarded by a shared secret: the request must carry it via the `x-refresh-secret`
 * header or `?secret=` query param, matching REFRESH_SECRET. If REFRESH_SECRET is
 * unset (local dev), the route runs unguarded.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = env.refreshSecret();
  if (!secret) return true; // no secret configured (local dev) → allow
  const provided =
    request.headers.get("x-refresh-secret") ??
    new URL(request.url).searchParams.get("secret");
  return provided === secret;
}

async function run(slug: string | null): Promise<Response> {
  const district = getDistrict(slug);
  if (!district) {
    return Response.json(
      { error: "Missing or unknown district", available: DISTRICTS.map((d) => d.slug) },
      { status: slug ? 404 : 400 },
    );
  }
  try {
    const diff = await refreshDistrict(district.slug);
    return Response.json(diff);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return run(new URL(request.url).searchParams.get("district"));
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: { district?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body → district falls through to the GET-style query param */
  }
  return run(body.district ?? new URL(request.url).searchParams.get("district"));
}
