/**
 * One-time tile optimiser — shrink already-generated tiles in place.
 *
 * Early tiles were stored as full-res (~1k px, ~2.6MB) PNGs but render at <=~95px
 * on screen, so first load pulled ~130MB. This re-reads each tile from Blob,
 * downscales to 512px max + palette-quantises (same as the updated bg-remove
 * tail), and overwrites it. No image generation — just resampling existing bytes.
 *
 * Run (writes to the Blob store in .env.local — the prod foodlondon store):
 *   node --conditions=react-server --env-file=.env.local --import tsx scripts/optimize-tiles.ts [slug]
 */
import sharp from "sharp";
import { getSnapshot, getTile, putTile } from "@/lib/store";

const slug = process.argv[2] ?? "soho";
const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`;

async function streamToBuffer(s: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = s.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function main() {
  const snap = await getSnapshot(slug);
  if (!snap) throw new Error(`No snapshot for ${slug}`);

  let before = 0;
  let after = 0;
  let done = 0;

  for (const spec of snap.specs) {
    const { grid_x: x, grid_y: y, name } = spec;
    const tile = await getTile(slug, x, y);
    if (!tile) {
      console.log(`⚠️  missing tile ${x}-${y} (${name})`);
      continue;
    }
    const src = await streamToBuffer(tile.stream);
    const out = await sharp(src)
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .png({ palette: true, quality: 90, effort: 7 })
      .toBuffer();

    // Only overwrite if we actually saved bytes (idempotent re-runs are no-ops).
    if (out.length < src.length) {
      await putTile(slug, x, y, out);
      before += src.length;
      after += out.length;
      done++;
      console.log(`✓ ${x}-${y} ${name}: ${kb(src.length)} → ${kb(out.length)}`);
    } else {
      console.log(`· ${x}-${y} ${name}: already small (${kb(src.length)})`);
    }
  }

  console.log(
    `\n${done} tiles shrunk: ${kb(before)} → ${kb(after)}` +
      (before ? ` (${(100 * (1 - after / before)).toFixed(0)}% smaller)` : ""),
  );
}

main();
