"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildingSpec } from "@/lib/discover";
import { projectInto, type Cityscape as CityscapeData } from "@/lib/cityscape-geom";
import Cityscape, { type Hero } from "@/components/Cityscape";
import JarvisOrb from "@/components/JarvisOrb";

const slug = "soho";

export default function CityViewer() {
  const [scape, setScape] = useState<CityscapeData | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [selected, setSelected] = useState<Hero | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  const [view, setView] = useState({ scale: 0.4, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  // Zoom-out floor: you can never zoom out past the whole-city fit scale.
  const minScale = useRef(0.05);

  // Fit the whole city to the viewport (isometric.nyc style — screen always full).
  const fit = useCallback(() => {
    const el = mapRef.current;
    if (!el || !scape) return;
    const s = Math.min(el.clientWidth / scape.meta.width, el.clientHeight / scape.meta.height) * 0.96;
    minScale.current = s;
    setView({ scale: s, tx: 0, ty: 0 });
  }, [scape]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const loadHeroes = useCallback(async (s: string) => {
    const res = await fetch(`/api/snapshot?district=${s}`);
    if (!res.ok) return [] as Hero[];
    const snap = await res.json();
    return (snap.specs ?? []).map(
      (sp: BuildingSpec & { tile_url: string; place?: Hero["place"] }): Hero => ({
        lat: sp.lat,
        lng: sp.lng,
        name: sp.name,
        cuisine: sp.cuisine,
        signature_dish: sp.signature_dish,
        address: sp.address,
        tile_url: sp.tile_url,
        place: sp.place,
      }),
    );
  }, []);

  // --- JARVIS drives these ---
  // Fly the camera so (lat,lng) centres in the viewport, at absolute `zoom`.
  // Mirrors the content transform: translate(-50%,-50%) translate(tx,ty) scale(s)
  // → to centre a content point p, (tx,ty) = -s · (p − meta-centre).
  const focus = useCallback(
    (lat: number, lng: number, zoom = 1.3) => {
      const sc = scape;
      if (!sc) return;
      const [px, py] = projectInto(sc.meta, lat, lng);
      const s = Math.min(4, Math.max(minScale.current, zoom));
      setView({
        scale: s,
        tx: -s * (px - sc.meta.width / 2),
        ty: -s * (py - sc.meta.height / 2),
      });
    },
    [scape],
  );

  const highlight = useCallback((names: string[]) => {
    setHighlighted(new Set(names));
  }, []);

  // Kick the autonomous agent, then reload the heroes the new snapshot produced.
  const triggerRefresh = useCallback(async () => {
    try {
      await fetch(`/api/refresh?district=${slug}`, { method: "POST" });
    } catch (err) {
      console.error("JARVIS refresh failed:", err);
    }
    setHeroes(await loadHeroes(slug));
  }, [loadHeroes]);

  // On district change: load the real cityscape + any built food heroes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [scapeRes, hs] = await Promise.all([
          fetch(`/api/cityscape?district=${slug}`),
          loadHeroes(slug),
        ]);
        if (cancelled) return;
        if (!scapeRes.ok) throw new Error(`cityscape failed (${scapeRes.status})`);
        const sc = (await scapeRes.json()) as CityscapeData;
        if (cancelled) return;
        setScape(sc);
        setHeroes(hs);
      } catch (err) {
        if (!cancelled) console.error("Foodscape load failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHeroes]);

  // --- Camera ---
  const clampScale = (s: number) => Math.min(4, Math.max(minScale.current, s));
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setView((v) => ({ ...v, scale: clampScale(v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) }));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const cx = e.clientX;
    const cy = e.clientY;
    setView((v) => ({ ...v, tx: d.tx + (cx - d.x), ty: d.ty + (cy - d.y) }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div
      ref={mapRef}
      className="relative h-screen w-full cursor-grab overflow-hidden bg-[#15171c] text-zinc-100 active:cursor-grabbing"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: `translate(-50%,-50%) translate(${view.tx}px,${view.ty}px) scale(${view.scale})`,
          transformOrigin: "center",
        }}
      >
        {scape && (
          <Cityscape
            scape={scape}
            heroes={heroes}
            onSelect={setSelected}
            highlighted={highlighted}
          />
        )}
      </div>

      {/* Floating label (no banner, explore-only). */}
      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <span className="rounded-full bg-black/55 px-3 py-1.5 font-mono text-xs font-bold tracking-tight text-amber-300 backdrop-blur">
          FOODSCAPE · Soho
        </span>
      </div>

        {selected && (
          <div className="absolute bottom-4 left-4 z-30 w-72 rounded-xl border border-white/10 bg-zinc-900/95 p-4 shadow-xl backdrop-blur">
            <button
              onClick={() => setSelected(null)}
              className="absolute right-2 top-2 h-6 w-6 rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
            <div className="text-base font-semibold text-amber-300">{selected.name}</div>
            {selected.cuisine && (
              <div className="mt-0.5 text-xs uppercase tracking-wide text-zinc-400">
                {selected.cuisine}
              </div>
            )}
            {selected.signature_dish && (
              <div className="mt-2 text-sm text-zinc-200">
                <span className="text-zinc-500">Signature: </span>
                {selected.signature_dish}
              </div>
            )}
            {selected.address && (
              <div className="mt-1 text-xs text-zinc-400">{selected.address}</div>
            )}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${selected.name ?? ""} ${selected.address ?? ""}`.trim() ||
                  `${selected.lat},${selected.lng}`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-emerald-300"
            >
              Open in Google Maps ↗
            </a>
          </div>
        )}

        <JarvisOrb
          district={slug}
          onFocus={focus}
          onHighlight={highlight}
          onRefresh={triggerRefresh}
          onResetView={fit}
        />
    </div>
  );
}
