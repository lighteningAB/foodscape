import { getSnapshot } from "@/lib/store";
import { getDistrict, DISTRICTS } from "@/lib/london";

/**
 * GET /api/snapshot?district=<slug>
 * Returns the stored DistrictSnapshot (the agent's persisted world model) so the
 * viewer can show an already-built city instantly — without re-discovering or
 * regenerating. 404 if the district has never been built. Phase 4 reads the same
 * snapshot to diff against a fresh one.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("district");
  const district = getDistrict(slug);
  if (!district) {
    return Response.json(
      { error: "Missing or unknown district", available: DISTRICTS.map((d) => d.slug) },
      { status: slug ? 404 : 400 },
    );
  }

  const snap = await getSnapshot(district.slug);
  if (!snap) {
    return Response.json({ error: "No snapshot yet", slug: district.slug }, { status: 404 });
  }
  return Response.json(snap);
}
