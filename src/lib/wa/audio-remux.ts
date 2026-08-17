/**
 * Turning what a browser can record into what WhatsApp will accept.
 *
 * Meta accepts five audio types and `audio/webm` is not one of them — and a
 * *voice note*, the thing with a waveform and a microphone icon that plays
 * without being downloaded first, narrows that to Ogg carrying OPUS, mono. Every
 * other accepted format arrives as a file attachment with a music icon.
 *
 * Chrome cannot produce Ogg. Not yet, but structurally: Chromium's muxer accepts
 * webm, x-matroska and mp4 containers, and Ogg is absent from the list entirely
 * rather than being an unimplemented pairing. Since Chrome is most of the team,
 * "record it and upload it" would work for whoever tested on Safari and fail for
 * everyone else, at send time, in production.
 *
 * The saving detail is that WebM/Opus and Ogg/Opus carry BYTE-IDENTICAL Opus
 * packets. Only the framing differs — Matroska clusters versus Ogg pages, plus
 * an OpusHead/OpusTags preamble. So this is a remux, not a transcode: the packets
 * are copied across, never decoded and re-encoded. That is what makes it possible
 * without ffmpeg, which does not fit in a serverless function, and it means the
 * audio is bit-for-bit what the microphone produced.
 *
 * It runs on the server rather than in the browser for three reasons: the bytes
 * have to come here anyway because the WABA token lives here, this is the one
 * place the result can be checked before Meta sees it, and a bug can be fixed by
 * deploying rather than by waiting for caches to expire.
 */
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  OggOutputFormat,
  Output,
} from "mediabunny";

export const WA_VOICE_MIME = "audio/ogg";

export type RemuxResult =
  | { ok: true; bytes: Uint8Array; channels: number; sampleRate: number }
  | { ok: false; reason: RemuxFailure; detail: string };

/**
 * Why a recording could not become a voice note. Named rather than a bare
 * message because the composer says something different for each, and because
 * `not_opus` is a browser problem while `remux_failed` is ours.
 */
export type RemuxFailure = "no_audio_track" | "not_opus" | "not_mono" | "remux_failed";

/**
 * Repackage recorded audio as Ogg/Opus.
 *
 * Accepts whatever container the browser produced — WebM from Chrome, Ogg from
 * Firefox, and it is happy to pass the latter through the same path rather than
 * special-casing it, because one code path is one place for this to be wrong.
 */
export async function remuxToOggOpus(input: ArrayBuffer): Promise<RemuxResult> {
  try {
    const source = new Input({ source: new BufferSource(input), formats: ALL_FORMATS });
    const track = await source.getPrimaryAudioTrack();
    if (!track) return { ok: false, reason: "no_audio_track", detail: "the recording carried no audio track" };

    const codec = await track.getCodec();
    // Checked HERE, not at Meta. A wrong codec reaching Graph comes back as
    // error 131053 with a message that lists the legal types and does not say
    // which one you sent — a production-only failure with a poor diagnostic,
    // when the answer was knowable before the request was made.
    if (codec !== "opus") {
      return { ok: false, reason: "not_opus", detail: `recorded as ${codec ?? "an unknown codec"}, not opus` };
    }
    if (track.numberOfChannels !== 1) {
      // Meta's own wording: "OPUS codecs only; base audio/ogg not supported;
      // mono input only". Stereo is rejected even with the right container and
      // codec, so capture constrains it and this refuses to guess by downmixing.
      return {
        ok: false,
        reason: "not_mono",
        detail: `recorded in ${track.numberOfChannels} channels; WhatsApp voice notes must be mono`,
      };
    }

    // The OpusHead the Ogg stream opens with. Without it the output is Opus
    // data that nothing can identify as Opus — so a missing config is a failure
    // to report, not something to proceed past.
    const decoderConfig = await track.getDecoderConfig();
    if (!decoderConfig) {
      return { ok: false, reason: "remux_failed", detail: "the recording carried no decoder configuration" };
    }

    const target = new BufferTarget();
    const output = new Output({ format: new OggOutputFormat(), target });
    const audio = new EncodedAudioPacketSource("opus");
    output.addAudioTrack(audio);
    await output.start();

    const sink = new EncodedPacketSink(track);
    const meta = { decoderConfig };
    let first = true;
    let packets = 0;
    for await (const packet of sink.packets()) {
      // The config rides with the first packet only.
      await audio.add(packet, first ? meta : undefined);
      first = false;
      packets++;
    }
    await output.finalize();

    if (packets === 0 || !target.buffer) {
      return { ok: false, reason: "remux_failed", detail: "the recording held no audio packets" };
    }

    return {
      ok: true,
      bytes: new Uint8Array(target.buffer),
      channels: track.numberOfChannels,
      sampleRate: track.sampleRate,
    };
  } catch (e) {
    return { ok: false, reason: "remux_failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** What to tell the person who pressed record. */
export function remuxFailureMessage(reason: RemuxFailure): string {
  switch (reason) {
    case "no_audio_track":
      return "That recording had no sound in it. Check the microphone and try again.";
    case "not_opus":
      return "Your browser recorded in a format WhatsApp cannot use for voice notes. Chrome, Edge and Firefox all work; Safari needs 18.4 or newer.";
    case "not_mono":
      return "That recording came through in stereo, which WhatsApp voice notes do not allow. Try again.";
    case "remux_failed":
      return "That recording could not be prepared for WhatsApp. Try again, and tell an admin if it keeps happening.";
  }
}
