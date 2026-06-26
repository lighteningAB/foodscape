"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * JARVIS — the floating voice orb (the ElevenLabs sponsor surface + nav UX).
 *
 * Pipeline: mic → Web Speech API STT → transcript → POST /api/jarvis (Gemini
 * intent + snapshot query) → drive the map via callbacks → POST /api/narrate
 * (ElevenLabs TTS) → play the reply. STT is browser-only and lives here, not in
 * a route. Degrades gracefully: no SpeechRecognition → a typed input; TTS
 * failure → the reply still shows as text.
 *
 * A dev hook `window.__jarvis(transcript)` runs the whole pipeline with a typed
 * transcript so the flow is testable headlessly (no real mic). It resolves to
 * the /api/jarvis JSON (also stashed on `window.__jarvisLast`).
 */

type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";

interface JarvisResult {
  action: "move_to" | "find_cuisine" | "describe" | "refresh";
  cuisine: string | null;
  district: string;
  reply_text: string;
  matches: Array<{ name: string; lat: number; lng: number }>;
  refreshed: unknown;
}

interface Props {
  district: string;
  /** Fly the camera so (lat,lng) centres, bumping zoom. */
  onFocus: (lat: number, lng: number, zoom?: number) => void;
  /** Ring/pulse the named food buildings (empty clears). */
  onHighlight: (names: string[]) => void;
  /** Kick the autonomous refresh agent + reload heroes. */
  onRefresh: () => void | Promise<void>;
  /** Reframe the whole city (move_to with nowhere to fly). */
  onResetView?: () => void;
}

// Minimal Web Speech API typings (not in the DOM lib by default).
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    __jarvis?: (transcript: string) => Promise<JarvisResult | null>;
    __jarvisLast?: JarvisResult | null;
  }
}

export default function JarvisOrb({
  district,
  onFocus,
  onHighlight,
  onRefresh,
  onResetView,
}: Props) {
  const [state, setState] = useState<OrbState>("idle");
  const [caption, setCaption] = useState<string>("");
  const [typed, setTyped] = useState("");
  const [showInput, setShowInput] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<OrbState>("idle");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const speak = useCallback(async (text: string) => {
    setState("speaking");
    try {
      const res = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`narrate ${res.status}`);
      const buf = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
    } catch {
      // TTS unavailable (rate-limit / bad key) — the caption already shows the text.
    } finally {
      setState("idle");
    }
  }, []);

  // The full pipeline for one spoken/typed command.
  const run = useCallback(
    async (transcript: string): Promise<JarvisResult | null> => {
      const t = transcript.trim();
      if (!t) return null;
      setCaption(`“${t}”`);
      setState("thinking");
      let result: JarvisResult | null = null;
      try {
        const res = await fetch("/api/jarvis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: t, district }),
        });
        if (!res.ok) throw new Error(`jarvis ${res.status}`);
        result = (await res.json()) as JarvisResult;
      } catch (err) {
        setState("error");
        setCaption("Sorry, I didn't catch that.");
        setTimeout(() => setState("idle"), 1500);
        console.error("JARVIS failed:", err);
        return null;
      }

      window.__jarvisLast = result;

      // Drive the map from the result.
      if (result.matches.length) {
        const n = result.matches.length;
        const cx = result.matches.reduce((s, m) => s + m.lat, 0) / n;
        const cy = result.matches.reduce((s, m) => s + m.lng, 0) / n;
        onFocus(cx, cy, result.action === "describe" ? 1.6 : 1.3);
        onHighlight(result.matches.map((m) => m.name));
      } else if (result.action === "find_cuisine") {
        onHighlight([]); // searched, found nothing — clear any prior ring
      } else if (result.action === "move_to") {
        onHighlight([]);
        onResetView?.();
      }

      if (result.action === "refresh") {
        await onRefresh();
      }

      setCaption(result.reply_text);
      await speak(result.reply_text);
      return result;
    },
    [district, onFocus, onHighlight, onRefresh, onResetView, speak],
  );

  // Expose the dev hook so the pipeline is drivable without a real mic.
  useEffect(() => {
    window.__jarvis = run;
    return () => {
      if (window.__jarvis === run) delete window.__jarvis;
    };
  }, [run]);

  // Particle orb — a canvas swarm that energises + recolours by state.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const SIZE = 64;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);
    const c = SIZE / 2;
    const maxR = c - 5;

    const N = 48;
    const particles = Array.from({ length: N }, (_, i) => ({
      angle: (i / N) * Math.PI * 2,
      base: 0.45 + ((i * 7) % 11) / 22, // 0.45..0.95 of maxR
      spin: 0.18 + ((i * 5) % 9) / 60,
      dir: i % 2 ? 1 : -1,
      size: 0.9 + ((i * 3) % 7) / 5,
      freq: 0.6 + ((i * 13) % 17) / 20,
      phase: (i * 1.7) % (Math.PI * 2),
    }));

    // [r,g,b] + energy per state.
    const look = (s: OrbState): { col: [number, number, number]; energy: number } => {
      switch (s) {
        case "listening":
          return { col: [52, 211, 153], energy: 1.25 };
        case "thinking":
          return { col: [96, 165, 250], energy: 0.95 };
        case "speaking":
          return { col: [56, 189, 248], energy: 1.55 };
        case "error":
          return { col: [248, 113, 113], energy: 0.7 };
        default:
          return { col: [59, 130, 246], energy: 0.45 };
      }
    };

    let raf = 0;
    let last = performance.now();
    let energy = 0.45;
    const col: [number, number, number] = [59, 130, 246];

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const target = look(stateRef.current);
      // Ease energy + colour toward the target for smooth state transitions.
      energy += (target.energy - energy) * Math.min(dt * 6, 1);
      for (let k = 0; k < 3; k++) col[k] += (target.col[k] - col[k]) * Math.min(dt * 6, 1);
      const t = now / 1000;
      const [r, g, b] = col.map(Math.round);

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.globalCompositeOperation = "lighter";

      // Core glow.
      const coreR = maxR * (0.42 + 0.08 * Math.sin(t * 2.2)) * (0.7 + 0.3 * energy);
      const core = ctx.createRadialGradient(c, c, 0, c, c, coreR);
      core.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
      core.addColorStop(0.5, `rgba(${r},${g},${b},0.35)`);
      core.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(c, c, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Orbiting particles.
      for (const p of particles) {
        p.angle += p.dir * p.spin * (0.4 + energy) * dt * 2.4;
        const rr =
          p.base * maxR * (0.78 + 0.22 * Math.sin(t * p.freq + p.phase)) * (0.6 + 0.45 * energy);
        const x = c + Math.cos(p.angle) * rr;
        const y = c + Math.sin(p.angle) * rr;
        const ps = p.size * (0.8 + 0.5 * energy);
        const grd = ctx.createRadialGradient(x, y, 0, x, y, ps * 2.2);
        grd.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
        grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(x, y, ps * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const startListening = useCallback(() => {
    if (state === "listening") {
      recognition.current?.stop();
      return;
    }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setShowInput(true); // no STT in this browser → typed fallback
      return;
    }
    const rec = new Ctor();
    recognition.current = rec;
    rec.lang = "en-GB";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      void run(transcript);
    };
    rec.onerror = (e) => {
      setState("error");
      setCaption(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Mic access blocked — type instead."
          : "Mic error — try again.",
      );
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setShowInput(true);
      setTimeout(() => setState("idle"), 1800);
    };
    rec.onend = () => {
      setState((s) => (s === "listening" ? "idle" : s));
    };
    setCaption("");
    setState("listening");
    try {
      rec.start();
    } catch {
      setState("idle");
    }
  }, [run, state]);

  const submitTyped = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const t = typed;
      setTyped("");
      void run(t);
    },
    [run, typed],
  );

  const busy = state === "thinking" || state === "speaking";
  const ring =
    state === "listening"
      ? "shadow-[0_0_40px_12px_rgba(52,211,153,0.7)]"
      : state === "thinking"
        ? "shadow-[0_0_40px_12px_rgba(96,165,250,0.7)]"
        : state === "speaking"
          ? "shadow-[0_0_44px_14px_rgba(56,189,248,0.8)]"
          : state === "error"
            ? "shadow-[0_0_36px_10px_rgba(248,113,113,0.7)]"
            : "shadow-[0_0_30px_9px_rgba(59,130,246,0.55)]";

  return (
    <div className="absolute bottom-5 right-5 z-20 flex flex-col items-end gap-2">
      {caption && (
        <div className="max-w-[16rem] rounded-2xl border border-white/10 bg-zinc-900/90 px-3.5 py-2 text-sm text-zinc-100 shadow-xl backdrop-blur">
          {caption}
        </div>
      )}

      {showInput && (
        <form onSubmit={submitTyped} className="flex items-center gap-1.5">
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Ask JARVIS…  e.g. find me ramen"
            className="w-56 rounded-full border border-white/10 bg-zinc-900/90 px-3.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-300/50"
          />
          <button
            type="submit"
            className="rounded-full bg-amber-400 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-300"
          >
            →
          </button>
        </form>
      )}

      <button
        onClick={startListening}
        disabled={busy}
        title={
          state === "listening"
            ? "Listening… click to stop"
            : busy
              ? "Working…"
              : "Talk to JARVIS"
        }
        aria-label="Talk to JARVIS"
        className={`relative grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-zinc-950/70 backdrop-blur transition-shadow duration-500 disabled:cursor-wait ${ring}`}
      >
        <canvas ref={canvasRef} width={64} height={64} className="h-16 w-16" />
      </button>
    </div>
  );
}
