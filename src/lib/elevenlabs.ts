import "server-only";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { env } from "@/lib/env";

/**
 * ElevenLabs TTS — JARVIS's voice (the ElevenLabs sponsor surface).
 *
 * `synthesize(text)` converts a spoken reply into MP3 bytes via the SDK
 * (@elevenlabs/elevenlabs-js v2.54). The voice is `ELEVENLABS_VOICE_ID` if set,
 * else the SDK's stock "Rachel" voice so it works key-only. The orb plays the
 * returned audio; if this throws (rate-limit / bad key — see PLAN §Secrets), the
 * caller degrades to text-only and the orb still works.
 */

/** Stock ElevenLabs voice ("Rachel") — used when ELEVENLABS_VOICE_ID is unset. */
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const MODEL_ID = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";

let _client: ElevenLabsClient | null = null;
function client(): ElevenLabsClient {
  _client ??= new ElevenLabsClient({ apiKey: env.elevenlabs() });
  return _client;
}

/** Render `text` to spoken MP3 bytes. Throws on API failure (caller degrades). */
export async function synthesize(text: string): Promise<Buffer> {
  const voiceId = env.elevenlabsVoiceId() ?? DEFAULT_VOICE_ID;
  const audio = await client().textToSpeech.convert(voiceId, {
    text,
    modelId: MODEL_ID,
    outputFormat: OUTPUT_FORMAT,
  });

  // convert() resolves to a ReadableStream<Uint8Array> of MP3 bytes.
  const chunks: Uint8Array[] = [];
  const reader = audio.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
