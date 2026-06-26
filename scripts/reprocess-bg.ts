/**
 * Re-key the background of tiles ALREADY stored for a district (generated before
 * bg-remove was wired in). Reads the snapshot, re-processes each tile in place.
 * Run: node --conditions=react-server --env-file=.env.local --import tsx scripts/reprocess-bg.ts <slug>
 */
import { getSnapshot, getTile, putTile } from "@/lib/store";
import { removeBackground } from "@/lib/bg-remove";

async function main() {
  const slug = process.argv[2] ?? "soho";
  const snap = await getSnapshot(slug);
  if (!snap) throw new Error(`No snapshot for ${slug}`);
  console.log(`reprocessing ${snap.specs.length} tiles for ${slug}…`);

  for (const s of snap.specs) {
    const tile = await getTile(slug, s.grid_x, s.grid_y);
    if (!tile) {
      console.log(`  ${s.grid_x}-${s.grid_y} missing, skip`);
      continue;
    }
    const buf = Buffer.from(await new Response(tile.stream).arrayBuffer());
    const out = await removeBackground(buf);
    await putTile(slug, s.grid_x, s.grid_y, out);
    console.log(`  ${s.grid_x}-${s.grid_y} ${s.name}: ${buf.length} → ${out.length}b`);
  }
  console.log("done");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
