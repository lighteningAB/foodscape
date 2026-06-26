import { parseJarvisIntent } from "@/lib/gemini";
import { getSnapshot } from "@/lib/store";
import { refreshDistrict } from "@/lib/agent";
import { getDistrict } from "@/lib/london";

/**
 * POST /api/jarvis   body { transcript, district? }
 *
 * The JARVIS nav brain: Gemini parses the spoken transcript into a structured
 * intent (move_to | find_cuisine | describe | refresh), then this route acts on
 * it and returns both what the map should do AND the line to speak.
 *
 *   find_cuisine → load the district snapshot, fuzzy-match specs on
 *     cuisine + food_material + signature_dish + name → matches[{name,lat,lng}].
 *   refresh      → kick the Phase 4 agent for the district, narrate the diff.
 *   move_to      → resolve a target district (only Soho is built today, so a
 *                  named other district is acknowledged but the camera reframes
 *                  Soho — see PLAN single-district note).
 *   describe     → return the best/representative spot to talk about.
 *
 * The client flies the camera + highlights from `matches`, then POSTs
 * `reply_text` to /api/narrate for the voice.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Match {
  name: string;
  lat: number;
  lng: number;
}

const norm = (s: string) => s.toLowerCase();

/** Does a spec match the cuisine keyword (across cuisine/material/dish/name)? */
function specMatches(
  spec: { name: string; cuisine: string; food_material: string; signature_dish: string },
  keyword: string,
): boolean {
  const hay = norm(
    `${spec.cuisine} ${spec.food_material} ${spec.signature_dish} ${spec.name}`,
  );
  // Match if any word of the keyword appears (so "ramen noodles" still hits "ramen").
  return keyword
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .some((w) => hay.includes(norm(w)));
}

export async function POST(request: Request) {
  let body: { transcript?: string; district?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* empty body → guard below */
  }
  const transcript = (body.transcript ?? "").trim();
  if (!transcript) {
    return Response.json({ error: "Missing transcript" }, { status: 400 });
  }

  const current = getDistrict(body.district) ?? getDistrict("soho")!;

  let intent;
  try {
    intent = await parseJarvisIntent(transcript, current.name);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Resolve the working district. Only Soho is built today, so an unbuilt named
  // district falls back to the current one (camera reframes Soho).
  const wanted = intent.district ? getDistrict(intent.district) : null;
  const target = wanted ?? current;
  let reply_text = intent.reply_text;
  let matches: Match[] = [];
  let refreshed: Awaited<ReturnType<typeof refreshDistrict>> | null = null;

  if (intent.action === "find_cuisine" && intent.cuisine) {
    const snap = await getSnapshot(target.slug);
    const specs = snap?.specs ?? [];
    matches = specs
      .filter((s) => specMatches(s, intent.cuisine!))
      .map((s) => ({ name: s.name, lat: s.lat, lng: s.lng }));
    if (!matches.length) {
      reply_text = `Hmm, I couldn't find any ${intent.cuisine} spots in ${target.name} yet.`;
    } else {
      reply_text = `Found ${matches.length} ${intent.cuisine} ${
        matches.length === 1 ? "spot" : "spots"
      } in ${target.name}. Flying you there.`;
    }
  } else if (intent.action === "refresh") {
    try {
      refreshed = await refreshDistrict(target.slug);
      const { added, changed, removed } = refreshed;
      const parts = [
        added.length && `${added.length} new`,
        changed.length && `${changed.length} updated`,
        removed.length && `${removed.length} gone`,
      ].filter(Boolean);
      reply_text = parts.length
        ? `Refreshed ${target.name}: ${parts.join(", ")}.`
        : `I rescanned ${target.name} — nothing's changed.`;
    } catch (err) {
      reply_text = `I couldn't refresh ${target.name} right now.`;
      return Response.json(
        {
          action: intent.action,
          district: target.slug,
          reply_text,
          error: err instanceof Error ? err.message : String(err),
        },
        { status: 200 },
      );
    }
  } else if (intent.action === "describe") {
    const snap = await getSnapshot(target.slug);
    const best = snap?.specs?.[0];
    if (best) {
      matches = [{ name: best.name, lat: best.lat, lng: best.lng }];
      if (!intent.district) {
        reply_text = `${best.name} is a great pick here — known for ${best.signature_dish}.`;
      }
    }
  } else if (intent.action === "move_to" && wanted && wanted.slug !== current.slug) {
    // Named a district we haven't built — acknowledge, reframe what we have.
    reply_text = `${wanted.name} isn't on the map yet — here's ${current.name}.`;
  }

  return Response.json({
    action: intent.action,
    cuisine: intent.cuisine ?? null,
    district: target.slug,
    reply_text,
    matches,
    refreshed,
  });
}
