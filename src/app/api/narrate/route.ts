import { synthesize } from "@/lib/elevenlabs";

/**
 * POST /api/narrate   body { text }
 * Renders `text` to spoken MP3 (ElevenLabs) and returns it as audio/mpeg — the
 * voice JARVIS plays. If TTS fails (rate-limit / bad key), returns 502 so the
 * orb degrades to text-only without crashing.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { text?: string } = {};
  try {
    body = (await request.json()) as { text?: string };
  } catch {
    /* fall through to the empty-text guard */
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return Response.json({ error: "Missing text" }, { status: 400 });
  }

  try {
    const mp3 = await synthesize(text);
    return new Response(new Uint8Array(mp3), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(mp3.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
