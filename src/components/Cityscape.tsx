"use client";

import { useMemo } from "react";
import { projectInto, type Cityscape as CityscapeData, type Place } from "@/lib/cityscape-geom";

export interface Hero {
  lat: number;
  lng: number;
  name?: string;
  cuisine?: string;
  signature_dish?: string;
  address?: string;
  tile_url?: string;
  /** Where to draw the food sprite so it overlays its real footprint. */
  place?: Place;
}

interface Props {
  scape: CityscapeData;
  heroes: Hero[];
  onSelect: (h: Hero) => void;
  /** Food-building names to ring/pulse (JARVIS search results). */
  highlighted?: Set<string>;
}

type Pt = [number, number];

interface GreyItem {
  kind: "grey";
  frontY: number;
  roof: string;
  roofFill: string;
  walls: { pts: string; fill: string }[];
}
interface FoodItem {
  kind: "food";
  frontY: number;
  hero: Hero;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Real district: OSM streets + footprints extruded into plain grey iso massing
 * (the normal city). Restaurant food buildings sit on their footprints. Grey
 * buildings AND food buildings are drawn in ONE back-to-front pass (inside the
 * SVG) so a nearer building correctly occludes a farther one — food buildings no
 * longer clip through their neighbours. Food buildings are clickable → popup.
 */
export default function Cityscape({ scape, heroes, onSelect, highlighted }: Props) {
  const { meta, roads, buildings } = scape;

  const streets = useMemo(
    () =>
      roads.map((r, i) => (
        <polyline
          key={i}
          points={r.pts.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke="#33363e"
          strokeWidth={r.w}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )),
    [roads],
  );

  const draw = useMemo(() => {
    // Food placements (over their real footprints), and which footprint each replaces.
    const foods: FoodItem[] = [];
    const skip = new Set<number>();
    for (const hero of heroes) {
      if (!hero.tile_url) continue;
      const box: Place =
        hero.place ??
        (() => {
          const [x, y] = projectInto(meta, hero.lat, hero.lng);
          return { x: x - 60, y: y - 110, w: 120, h: 120, cx: x, cy: y };
        })();
      // Nearest footprint → skip its grey extrusion (food replaces it).
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < buildings.length; i++) {
        const pts = buildings[i].pts as Pt[];
        let cx = 0, cy = 0;
        for (const [x, y] of pts) { cx += x; cy += y; }
        const d = (cx / pts.length - box.cx) ** 2 + (cy / pts.length - box.cy) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) skip.add(best);

      // Display size: a bit bigger than the footprint so landmarks read, but
      // clamped so an over-matched big footprint can't produce a monster.
      const dw = Math.min(Math.max(box.w, 38) * 1.9, 95);
      const dh = dw * 1.3;
      foods.push({
        kind: "food",
        frontY: box.y + box.h,
        hero,
        x: box.cx - dw / 2,
        y: box.y + box.h - dh,
        w: dw,
        h: dh,
      });
    }

    const items: (GreyItem | FoodItem)[] = [...foods];
    buildings.forEach((b, idx) => {
      if (skip.has(idx)) return;
      const base = b.pts as Pt[];
      const frontY = Math.max(...base.map((p) => p[1]));
      const cx = base.reduce((s, p) => s + p[0], 0) / base.length;
      const cy = base.reduce((s, p) => s + p[1], 0) / base.length;
      const roof: Pt[] = base.map(([x, y]) => [x, y - b.h]);
      const L = 60 + b.tone * 14;
      const roofFill = `hsl(36 12% ${L + 6}%)`;
      const seFill = `hsl(36 12% ${L - 12}%)`;
      const swFill = `hsl(36 12% ${L - 24}%)`;
      const walls: { pts: string; fill: string }[] = [];
      for (let i = 0; i < base.length; i++) {
        const a = base[i];
        const bb = base[(i + 1) % base.length];
        const ar = roof[i];
        const br = roof[(i + 1) % base.length];
        let nx = bb[1] - a[1];
        let ny = -(bb[0] - a[0]);
        if (nx * ((a[0] + bb[0]) / 2 - cx) + ny * ((a[1] + bb[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
        if (ny <= 0) continue;
        walls.push({ pts: `${a[0]},${a[1]} ${bb[0]},${bb[1]} ${br[0]},${br[1]} ${ar[0]},${ar[1]}`, fill: nx >= 0 ? seFill : swFill });
      }
      items.push({ kind: "grey", frontY, roof: roof.map((p) => p.join(",")).join(" "), roofFill, walls });
    });
    // One painter's-order pass: farther (smaller frontY) first.
    items.sort((a, b) => a.frontY - b.frontY);
    return items;
  }, [buildings, heroes, meta]);

  return (
    <div style={{ position: "relative", width: meta.width, height: meta.height }}>
      <svg
        width={meta.width}
        height={meta.height}
        viewBox={`0 0 ${meta.width} ${meta.height}`}
        style={{ position: "absolute", inset: 0, display: "block" }}
      >
        <rect width={meta.width} height={meta.height} fill="#16181d" />
        <g>{streets}</g>
        {draw.map((d, i) =>
          d.kind === "grey" ? (
            <g key={i} shapeRendering="crispEdges">
              {d.walls.map((w, j) => (
                <polygon key={j} points={w.pts} fill={w.fill} />
              ))}
              <polygon points={d.roof} fill={d.roofFill} stroke="rgba(0,0,0,0.18)" strokeWidth={0.5} />
            </g>
          ) : (
            <g key={i}>
              {d.hero.name && highlighted?.has(d.hero.name) && (
                <ellipse
                  cx={d.x + d.w / 2}
                  cy={d.frontY}
                  rx={d.w * 0.58}
                  ry={d.w * 0.24}
                  fill="rgba(52,211,153,0.18)"
                  stroke="#34d399"
                  strokeWidth={2.5}
                >
                  <animate
                    attributeName="opacity"
                    values="1;0.35;1"
                    dur="1.3s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="rx"
                    values={`${d.w * 0.5};${d.w * 0.62};${d.w * 0.5}`}
                    dur="1.3s"
                    repeatCount="indefinite"
                  />
                </ellipse>
              )}
              <image
                href={d.hero.tile_url}
                x={d.x}
                y={d.y}
                width={d.w}
                height={d.h}
                preserveAspectRatio="xMidYMax meet"
                style={{ cursor: "pointer", imageRendering: "pixelated" }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(d.hero);
                }}
              />
            </g>
          ),
        )}
      </svg>
    </div>
  );
}
