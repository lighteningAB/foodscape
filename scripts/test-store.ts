/**
 * Phase 3 smoke test — exercises the NEW path (Nano Banana → private Blob →
 * snapshot → read-back) without Tavily/OSM. One image-gen call.
 *
 * Run:
 *   node --conditions=react-server --env-file=.env.local --import tsx scripts/test-store.ts
 */
import { generateImage } from "@/lib/gemini";
import { buildBuildingPrompt } from "@/lib/style-anchor";
import {
  putTile,
  putSnapshot,
  getSnapshot,
  getTile,
  tileProxyUrl,
  type DistrictSnapshot,
} from "@/lib/store";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SLUG = "soho";
const X = 0;
const Y = 0;

async function main() {
  console.log("1/5 reading style anchor…");
  const anchor = (await readFile(join(process.cwd(), "public", "style-anchor.png"))).toString(
    "base64",
  );

  console.log("2/5 generating one food tile (Nano Banana)…");
  const img = await generateImage(
    buildBuildingPrompt(
      "a 4-storey Georgian terraced townhouse with a pitched roof and 3 window bays",
      "a packed wall of nigiri sushi and nori",
    ),
    anchor,
  );
  console.log(`   got ${img.bytes.length} bytes (${img.mimeType})`);

  console.log("3/5 putTile → private Blob…");
  const blobUrl = await putTile(SLUG, X, Y, img.bytes);
  console.log(`   blob url: ${blobUrl}`);
  console.log(`   proxy url: ${tileProxyUrl(SLUG, X, Y)}`);

  console.log("4/5 putSnapshot…");
  const snap: DistrictSnapshot = {
    slug: SLUG,
    updated_at: new Date().toISOString(),
    specs: [
      {
        name: "Test Sushi Co.",
        cuisine: "Japanese",
        signature_dish: "Nigiri",
        food_material: "a packed wall of nigiri sushi and nori",
        real_form: "a 4-storey Georgian terraced townhouse",
        grid_x: X,
        grid_y: Y,
        lat: 51.5137,
        lng: -0.1337,
        address: "1 Test St, Soho, London",
        building: {
          storeys: 4,
          heightM: null,
          buildingType: "terrace",
          roof: "pitched",
          footprint: { widthM: 8, depthM: 12 },
          matched: true,
          osmId: null,
        },
        tile_url: tileProxyUrl(SLUG, X, Y),
      },
    ],
    changes: [],
  };
  await putSnapshot(snap);

  console.log("5/5 read-back: getSnapshot + getTile…");
  const back = await getSnapshot(SLUG);
  if (!back) throw new Error("getSnapshot returned null");
  console.log(`   snapshot: slug=${back.slug} specs=${back.specs.length} updated=${back.updated_at}`);

  const tile = await getTile(SLUG, X, Y);
  if (!tile) throw new Error("getTile returned null");
  const bytes = await new Response(tile.stream).arrayBuffer();
  console.log(`   tile read back: ${bytes.byteLength} bytes (${tile.contentType})`);

  console.log("\n✅ Phase 3 store round-trip OK.");
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
