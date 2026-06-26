/**
 * Validate bg-remove on a local PNG.
 * Run: node --conditions=react-server --env-file=.env.local --import tsx scripts/test-bg.ts <in.png> <out.png>
 */
import { removeBackground } from "@/lib/bg-remove";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

async function main() {
  const inPath = process.argv[2] ?? "/tmp/t1.png";
  const outPath = process.argv[3] ?? "/tmp/t1-out.png";
  const out = await removeBackground(await readFile(inPath));
  await writeFile(outPath, out);

  // Report corner + a few interior alphas.
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const a = (x: number, y: number) => data[(y * width + x) * 4 + 3];
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparent++;
  console.log({
    out: outPath,
    corner_alpha: a(2, 2),
    center_alpha: a(Math.floor(width / 2), Math.floor(height / 2)),
    transparent_pct: Math.round((transparent / (width * height)) * 100),
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
