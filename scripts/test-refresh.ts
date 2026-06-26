/**
 * Phase 4 smoke test — proves the refresh agent's diff + selective regen WITHOUT
 * Tavily or Nano Banana. Stubs `discover` (the fresh world) and `build` (records
 * which tiles were regenerated). Seeds a snapshot, runs refreshDistrict, asserts
 * the classification and that only added/changed tiles were rebuilt (unchanged
 * keep their old tile_url). Backs up and restores the real soho snapshot so it
 * doesn't clobber the built city.
 *
 * Run:
 *   node --conditions=react-server --env-file=.env.local --import tsx scripts/test-refresh.ts
 */
import { refreshDistrict } from "@/lib/agent";
import { getSnapshot, putSnapshot, type DistrictSnapshot, type SnapshotSpec } from "@/lib/store";
import type { BuildingSpec } from "@/lib/discover";
import type { Cityscape } from "@/lib/cityscape";

const SLUG = "soho";

function spec(over: Partial<BuildingSpec> & { name: string }): BuildingSpec {
  return {
    name: over.name,
    cuisine: over.cuisine ?? "test",
    signature_dish: over.signature_dish ?? "dish",
    food_material: over.food_material ?? "material",
    real_form: over.real_form ?? "a building",
    grid_x: over.grid_x ?? 0,
    grid_y: over.grid_y ?? 0,
    lat: over.lat ?? 51.51,
    lng: over.lng ?? -0.13,
    address: over.address ?? "Soho, London",
    building: over.building ?? {
      storeys: null,
      heightM: null,
      buildingType: null,
      roof: null,
      footprint: null,
      matched: false,
      osmId: null,
    },
  };
}

function snap(name: string, s: BuildingSpec): SnapshotSpec {
  return { ...s, tile_url: `OLD:${name}` };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the snapshot until our seed (exactly Alpha/Bravo/Charlie) is visible. */
async function waitForSeed() {
  for (let i = 0; i < 30; i++) {
    const s = await getSnapshot(SLUG);
    const names = (s?.specs ?? []).map((x) => x.name).sort().join("|");
    if (names === "Alpha|Bravo|Charlie") return;
    await sleep(1000);
  }
  throw new Error("seed snapshot never became visible (Blob propagation timeout)");
}

async function main() {
  // 1. Back up the real snapshot so we can restore it afterwards.
  const backup = await getSnapshot(SLUG);
  console.log(`Backed up real snapshot (${backup?.specs.length ?? 0} specs).`);

  try {
  // 2. Seed: three restaurants A, B, C (each with an existing tile).
  const A = spec({ name: "Alpha", signature_dish: "ramen", food_material: "noodles" });
  const B = spec({ name: "Bravo", signature_dish: "tacos", food_material: "tortilla", grid_x: 1 });
  const C = spec({ name: "Charlie", signature_dish: "sushi", food_material: "rice", grid_x: 2 });
  const seed: DistrictSnapshot = {
    slug: SLUG,
    updated_at: "2026-01-01T00:00:00.000Z",
    specs: [snap("Alpha", A), snap("Bravo", B), snap("Charlie", C)],
    changes: [],
  };
  await putSnapshot(seed);
  // Vercel Blob has read-after-overwrite lag — poll until the seed is visible
  // before the agent reads it, so the diff runs against the seed not the stale copy.
  await waitForSeed();
  console.log("Seeded snapshot: Alpha, Bravo, Charlie.");

  // 3. Fresh world: Alpha unchanged, Bravo's dish changed, Delta is new, Charlie gone.
  const freshAlpha = spec({ name: "alpha", signature_dish: "ramen", food_material: "noodles" }); // case-diff name
  const freshBravo = spec({ name: "Bravo", signature_dish: "burritos", food_material: "tortilla", grid_x: 1 });
  const freshDelta = spec({ name: "Delta", signature_dish: "pho", food_material: "broth", grid_x: 3 });
  const fresh = [freshAlpha, freshBravo, freshDelta];

  // 4. Stub build — records each regenerated tile, never hits Nano Banana.
  const built: string[] = [];
  const build = async (slug: string, _scape: Cityscape, s: BuildingSpec): Promise<SnapshotSpec> => {
    built.push(s.name);
    return { ...s, tile_url: `REGEN:${s.name}` };
  };

  // 5. Run the agent with the stubs.
  const diff = await refreshDistrict(SLUG, { discover: async () => fresh, build });
  console.log("Diff:", JSON.stringify({ added: diff.added, removed: diff.removed, changed: diff.changed, unchanged: diff.unchanged }));

  // 6. Assert classification.
  assert(sameSet(diff.unchanged, ["alpha"]), "Alpha classified unchanged (name match is case-insensitive)");
  assert(sameSet(diff.changed, ["Bravo"]), "Bravo classified changed (dish changed)");
  assert(sameSet(diff.added, ["Delta"]), "Delta classified added");
  assert(sameSet(diff.removed, ["Charlie"]), "Charlie classified removed");

  // 7. Assert ONLY changed + added were regenerated.
  assert(sameSet(built, ["Bravo", "Delta"]), "Only Bravo + Delta regenerated (Alpha reused, Charlie dropped)");

  // 8. Assert changes[] log.
  assert(diff.changes.length === 3, "changes[] has 3 entries (added + changed + removed)");
  const byKind = (k: string) => diff.changes.filter((c) => c.kind === k).map((c) => c.name);
  assert(sameSet(byKind("added"), ["Delta"]), "changes[] added = Delta");
  assert(sameSet(byKind("changed"), ["Bravo"]), "changes[] changed = Bravo");
  assert(sameSet(byKind("removed"), ["Charlie"]), "changes[] removed = Charlie");

  // 9. Read back the persisted snapshot — unchanged keeps its OLD tile, regen has REGEN.
  //    Poll past the same read-after-overwrite lag.
  // Unchanged reuses the OLD SnapshotSpec verbatim, so its persisted name stays
  // "Alpha" (the seed's casing) even though the fresh search returned "alpha".
  let after: DistrictSnapshot | null = null;
  for (let i = 0; i < 30; i++) {
    after = await getSnapshot(SLUG);
    if ((after?.specs ?? []).map((s) => s.name).sort().join("|") === "Alpha|Bravo|Delta") break;
    await sleep(1000);
  }
  if (!after) throw new Error("snapshot vanished after refresh");
  assert(sameSet(after.specs.map((s) => s.name), ["Alpha", "Bravo", "Delta"]), "snapshot specs = Alpha, Bravo, Delta (Charlie dropped)");
  const tile = (n: string) => after.specs.find((s) => s.name.toLowerCase() === n)?.tile_url;
  assert(tile("alpha") === "OLD:Alpha", "Alpha kept its OLD tile_url (not regenerated)");
  assert(tile("bravo") === "REGEN:Bravo", "Bravo got a fresh tile_url");
  assert(tile("delta") === "REGEN:Delta", "Delta got a fresh tile_url");

    console.log("\n✅ Phase 4 refresh agent verified.");
  } finally {
    // 10. Always restore the real snapshot — even if an assert throws — so a
    //     failed run never leaves test data in the live soho snapshot.
    if (backup) {
      await putSnapshot(backup);
      console.log("Restored real snapshot.");
    } else {
      console.log("No real snapshot to restore (test snapshot left in place).");
    }
  }
}

main().catch((err) => {
  console.error("\n❌ test-refresh failed:", err);
  process.exit(1);
});
