import "server-only";
import { discoverDistrict, type BuildingSpec } from "@/lib/discover";
import { getDistrict } from "@/lib/london";
import { buildCityscape, type Cityscape } from "@/lib/cityscape";
import { buildFoodTile } from "@/lib/foodbuilding";
import {
  getSnapshot,
  putSnapshot,
  getCityscape,
  putCityscape,
  type DistrictSnapshot,
  type SnapshotSpec,
  type ChangeLogEntry,
} from "@/lib/store";

/**
 * Phase 4 — the AUTONOMOUS refresh agent.
 *
 * `refreshDistrict(slug)` re-runs the Phase 2 discovery for a district, diffs the
 * fresh restaurant specs against the last persisted snapshot (keyed on restaurant
 * name), and acts on the diff:
 *   - added   (in fresh, not in old) → buildFoodTile (regenerate)
 *   - changed (same name, new signature_dish or food_material) → buildFoodTile
 *   - unchanged (same name + dish + material) → reuse the old SnapshotSpec as-is
 *                                               (keep its tile_url / place — no regen)
 *   - removed (in old, not in fresh) → dropped from the new snapshot
 *
 * Only added + changed buildings hit Nano Banana, so a refresh is cheap when the
 * world hasn't moved. The new snapshot + a changes[] log are written back to Blob;
 * the viewer reads the same snapshot and surfaces the diff.
 */

/** Normalised restaurant key (case/whitespace-insensitive) for matching. */
function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface RefreshDiff {
  slug: string;
  updated_at: string;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
  changes: ChangeLogEntry[];
}

/** Injectable seams (defaults = live discovery + real tile build). The test
 *  script overrides these to assert the diff/regen logic without Tavily or Nano
 *  Banana. Production callers pass nothing. */
export interface RefreshDeps {
  discover?: (slug: string) => Promise<BuildingSpec[]>;
  build?: (slug: string, scape: Cityscape, spec: BuildingSpec) => Promise<SnapshotSpec>;
}

export async function refreshDistrict(
  slug: string,
  deps: RefreshDeps = {},
): Promise<RefreshDiff> {
  const district = getDistrict(slug);
  if (!district) throw new Error(`Unknown district: ${slug}`);

  const discover = deps.discover ?? (async (s: string) => (await discoverDistrict(s)).specs);
  const build = deps.build ?? buildFoodTile;

  const fresh = await discover(district.slug);
  const oldSnap = await getSnapshot(district.slug);
  const old = oldSnap?.specs ?? [];

  const oldByKey = new Map<string, SnapshotSpec>(old.map((s) => [key(s.name), s]));
  const freshByKey = new Map(fresh.map((s) => [key(s.name), s]));

  // Load (or build + cache) the cityscape once; needed to regenerate any tile.
  let scape = await getCityscape(district.slug);
  if (!scape) {
    scape = await buildCityscape(district);
    await putCityscape(scape);
  }

  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  const removed: string[] = [];
  const changes: ChangeLogEntry[] = [];
  const nextSpecs: SnapshotSpec[] = [];

  // Walk the fresh world: classify each restaurant, regenerate only what moved.
  for (const spec of fresh) {
    const prev = oldByKey.get(key(spec.name));
    if (!prev) {
      const built = await build(district.slug, scape, spec);
      nextSpecs.push(built);
      added.push(spec.name);
      changes.push({ cell: [spec.grid_x, spec.grid_y], kind: "added", name: spec.name });
      continue;
    }
    const moved =
      prev.signature_dish !== spec.signature_dish ||
      prev.food_material !== spec.food_material;
    if (moved) {
      const built = await build(district.slug, scape, spec);
      nextSpecs.push(built);
      changed.push(spec.name);
      changes.push({ cell: [spec.grid_x, spec.grid_y], kind: "changed", name: spec.name });
    } else {
      // Unchanged: reuse the persisted tile (keep tile_url / place — no regen).
      nextSpecs.push(prev);
      unchanged.push(spec.name);
    }
  }

  // Anything in the old snapshot the fresh search no longer returns is removed.
  for (const prev of old) {
    if (!freshByKey.has(key(prev.name))) {
      removed.push(prev.name);
      changes.push({ cell: [prev.grid_x, prev.grid_y], kind: "removed", name: prev.name });
    }
  }

  const updated_at = new Date().toISOString();
  const snapshot: DistrictSnapshot = {
    slug: district.slug,
    updated_at,
    specs: nextSpecs,
    changes,
  };
  await putSnapshot(snapshot);

  return { slug: district.slug, updated_at, added, removed, changed, unchanged, changes };
}
