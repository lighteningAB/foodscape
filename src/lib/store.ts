import "server-only";
import { put, get } from "@vercel/blob";
import { env } from "@/lib/env";
import type { BuildingSpec } from "@/lib/discover";
import type { Cityscape, Place } from "@/lib/cityscape";

/**
 * Vercel Blob persistence (store: "foodlondon"). PRIVATE store — tile PNGs are
 * NOT publicly fetchable by URL; the browser reads them through the
 * /api/tile/[slug]/[cell] proxy, which fetches the blob with the server token
 * and streams it. The per-district snapshot is the agent's whole world model:
 * Phase 4 diffs a fresh snapshot against the stored one and regenerates only the
 * cells that changed.
 *
 * Blob layout (per PLAN.md):
 *   districts/<slug>.json        — DistrictSnapshot
 *   tiles/<slug>/<x>-<y>.png     — one rendered isometric food tile per cell
 */

/** A restaurant spec + its food-building tile + where to draw it on the real
 *  footprint it was generated from. */
export type SnapshotSpec = BuildingSpec & { tile_url: string; place?: Place };

export interface ChangeLogEntry {
  cell: [number, number];
  kind: "added" | "removed" | "changed";
  name: string;
}

export interface DistrictSnapshot {
  slug: string;
  /** ISO timestamp; set by the caller when written (no Date in scripts). */
  updated_at: string;
  /** Restaurant food buildings, placed on their real OSM footprints. Phase 4
   *  diffs these (keyed on name + cell). The regular city comes from cityscape. */
  specs: SnapshotSpec[];
  /** Diff log from the last refresh (Phase 4). Empty on a first generate. */
  changes: ChangeLogEntry[];
}

const ACCESS = "private" as const;

function token(): string {
  const t = env.blobToken();
  if (!t) throw new Error("Missing env var: BLOB_READ_WRITE_TOKEN");
  return t;
}

/** Blob pathname for a district snapshot. */
export function snapshotPath(slug: string): string {
  return `districts/${slug}.json`;
}

/** Blob pathname for a single tile PNG. */
export function tilePath(slug: string, x: number, y: number): string {
  return `tiles/${slug}/${x}-${y}.png`;
}

/**
 * Server-relative URL the browser <img> uses for a tile. Points at the proxy
 * route (not the private blob URL, which the browser can't read). Stable per
 * cell, so a regen replaces the bytes behind the same URL.
 */
export function tileProxyUrl(slug: string, x: number, y: number): string {
  return `/api/tile/${slug}/${x}-${y}`;
}

/** Upload a tile PNG (overwriting any prior tile in this cell). Returns blob url. */
export async function putTile(
  slug: string,
  x: number,
  y: number,
  bytes: Buffer,
): Promise<string> {
  const { url } = await put(tilePath(slug, x, y), bytes, {
    access: ACCESS,
    contentType: "image/png",
    allowOverwrite: true,
    token: token(),
  });
  return url;
}

/** Write (overwrite) the district snapshot JSON. Returns blob url. */
export async function putSnapshot(snap: DistrictSnapshot): Promise<string> {
  const { url } = await put(snapshotPath(snap.slug), JSON.stringify(snap, null, 2), {
    access: ACCESS,
    contentType: "application/json",
    allowOverwrite: true,
    token: token(),
  });
  return url;
}

/** Read the district snapshot, or null if none exists yet. */
export async function getSnapshot(slug: string): Promise<DistrictSnapshot | null> {
  const res = await get(snapshotPath(slug), { access: ACCESS, token: token() });
  if (!res || res.statusCode !== 200) return null;
  const text = await new Response(res.stream).text();
  return JSON.parse(text) as DistrictSnapshot;
}

// Bump when the Cityscape schema changes — Blob serves a stale copy after an
// overwrite (read-after-overwrite lag), so a new geometry shape needs a new key.
const CITYSCAPE_VERSION = 2;
const cityscapePath = (slug: string) => `cityscape/${slug}-v${CITYSCAPE_VERSION}.json`;

/** Real OSM cityscape geometry (roads + footprints), cached per district. */
export async function putCityscape(scape: Cityscape): Promise<string> {
  const { url } = await put(cityscapePath(scape.slug), JSON.stringify(scape), {
    access: ACCESS,
    contentType: "application/json",
    allowOverwrite: true,
    token: token(),
  });
  return url;
}

export async function getCityscape(slug: string): Promise<Cityscape | null> {
  const res = await get(cityscapePath(slug), { access: ACCESS, token: token() });
  if (!res || res.statusCode !== 200) return null;
  return JSON.parse(await new Response(res.stream).text()) as Cityscape;
}

/** A streamable tile read: the PNG byte stream + its content type. */
export interface TileStream {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
}

/** Fetch a tile's bytes for the proxy to stream. null if the tile isn't there. */
export async function getTile(
  slug: string,
  x: number,
  y: number,
): Promise<TileStream | null> {
  const res = await get(tilePath(slug, x, y), { access: ACCESS, token: token() });
  if (!res || res.statusCode !== 200) return null;
  return { stream: res.stream, contentType: res.blob.contentType ?? "image/png" };
}
