/**
 * Phase 2 harness — run the discover pipeline for one district, print JSON.
 *
 * Run:
 *   node --conditions=react-server --env-file=.env.local \
 *     --import tsx scripts/test-discover.ts [district-slug]
 *
 * Why --conditions=react-server: the libs import "server-only" (throws in plain
 * Node); the react-server export condition resolves it to a no-op. Same trick as
 * test-anchor.ts.
 *
 * Default district: soho. Prints the full spec array so you can eyeball real
 * restaurants, real building forms, and tiling food_material phrasing.
 */
import { discoverDistrict, specsFromWebContext } from "@/lib/discover";
import { getDistrict } from "@/lib/london";

/**
 * Offline sample web-context (used only when TAVILY_API_KEY is missing), so the
 * Gemini-extraction + OSM-real-form + grid half of the pipeline can still be
 * sanity-checked. Real Soho restaurants; mirrors Tavily snippet shape.
 */
const STUB_SOHO = `
SOURCE: Best restaurants in Soho London
Kiln, 58 Brewer Street, Soho, London W1F 9TL — Thai BBQ, signature clay-pot glass noodles with brown crab.
Bao Soho, 53 Lexington Street, Soho, London W1F 9AS — Taiwanese, signature fluffy gua bao buns with braised pork.
Bocca di Lupo, 12 Archer Street, Soho, London W1D 7BB — Italian, signature hand-made tortellini in brodo.
Barrafina, 26-27 Dean Street, Soho, London W1D 3LL — Spanish tapas, signature crispy tortilla and gambas.
Koya, 50 Frith Street, Soho, London W1D 4SQ — Japanese udon, signature hot udon in dashi broth.
Blacklock Soho, 24 Great Windmill Street, Soho, London W1D 7LG — British chophouse, signature charcoal-grilled lamb chops.
`.trim();

async function main() {
  const slug = process.argv[2] ?? "soho";
  const hasTavily = Boolean(process.env.TAVILY_API_KEY);
  console.error(`→ discovering ${slug}…`);

  let result;
  if (hasTavily) {
    result = await discoverDistrict(slug);
  } else {
    console.error("⚠ TAVILY_API_KEY missing — using STUB web context (Soho only).");
    const district = getDistrict(slug);
    if (!district) throw new Error(`Unknown district: ${slug}`);
    result = await specsFromWebContext(district, STUB_SOHO);
  }
  console.error(
    `✓ ${result.count} specs for ${result.district} ` +
      `(${result.specs.filter((s) => s.building.matched).length} matched a real OSM building)\n`,
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
