/**
 * Phase 1 throwaway harness — proves style coherence before we build anything.
 *
 * Run:
 *   node --conditions=react-server --env-file=.env.local \
 *     --import tsx scripts/test-anchor.ts
 *
 * Why --conditions=react-server: src/lib/env.ts imports "server-only", which
 * throws in a plain Node process. The react-server export condition resolves it
 * to a no-op so we can reuse the real server lib from a script.
 *
 * Output:
 *   public/style-anchor.png            (the locked reference, gen once)
 *   .style-test/<slug>.png             (3 anchored food-buildings to eyeball)
 *   .style-test/prompts.txt            (exact prompts used)
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { generateImage } from "@/lib/gemini";
import { ANCHOR_PROMPT, buildBuildingPrompt } from "@/lib/style-anchor";

const ROOT = process.cwd();
const ANCHOR_PATH = join(ROOT, "public", "style-anchor.png");
const OUT_DIR = join(ROOT, ".style-test");

// Real-ish London buildings, each RE-SKINNED in food (Phase 1 proves the trick;
// real forms come from OSM in Phase 2). { realForm } = the actual structure to
// keep recognizable, { food } = what it's rebuilt out of.
const BUILDINGS: Array<{ slug: string; realForm: string; food: string }> = [
  {
    slug: "soho-townhouse-sushi",
    realForm:
      "a 4-storey Georgian Soho terraced townhouse, brick facade, 3 window bays, flat parapet roof, ground-floor shopfront",
    food: "stacked nigiri sushi, maki rolls, and nori sheets",
  },
  {
    slug: "victorian-terrace-spaghetti",
    realForm:
      "a 3-storey Victorian terraced house with a pitched slate roof, bay window, and a chimney",
    food: "twirled spaghetti strands and meatballs with tomato sauce",
  },
  {
    slug: "railway-arch-tacos",
    realForm:
      "a low Victorian brick railway arch / viaduct unit, single wide arched opening, flat top",
    food: "folded hard-shell tacos with lettuce, cheese, and salsa spilling out",
  },
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const log: string[] = [];

  // 1. Anchor: gen once, reuse if present (so we don't redraw the style lock).
  let anchorBase64: string;
  if (await exists(ANCHOR_PATH)) {
    console.log("✓ anchor exists, reusing", ANCHOR_PATH);
    anchorBase64 = (await readFile(ANCHOR_PATH)).toString("base64");
  } else {
    console.log("→ generating style anchor…");
    log.push("=== ANCHOR_PROMPT ===\n" + ANCHOR_PROMPT + "\n");
    const anchor = await generateImage(ANCHOR_PROMPT);
    await writeFile(ANCHOR_PATH, anchor.bytes);
    anchorBase64 = anchor.base64;
    console.log("✓ wrote", ANCHOR_PATH);
  }

  // 2. Three buildings, each conditioned on the anchor image.
  for (const b of BUILDINGS) {
    const prompt = buildBuildingPrompt(b.realForm, b.food);
    log.push(`=== ${b.slug} ===\n${prompt}\n`);
    console.log(`→ generating ${b.slug}…`);
    const img = await generateImage(prompt, anchorBase64);
    const out = join(OUT_DIR, `${b.slug}.png`);
    await writeFile(out, img.bytes);
    console.log(`✓ wrote ${out} (${img.bytes.length} bytes)`);
  }

  await writeFile(join(OUT_DIR, "prompts.txt"), log.join("\n"));
  console.log("\nDone. Eyeball:", OUT_DIR);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
