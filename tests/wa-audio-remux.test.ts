import { describe, it, expect } from "vitest";
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  Input,
  Output,
  WebMOutputFormat,
  OggOutputFormat,
} from "mediabunny";
import { remuxToOggOpus, remuxFailureMessage } from "@/lib/wa/audio-remux";

/**
 * WhatsApp shows a voice note — waveform, microphone icon, plays without being
 * downloaded — only for Ogg carrying OPUS, mono. Chrome cannot record Ogg at
 * all, so every recording it makes has to be repackaged before Meta sees it.
 *
 * These prove the repackaging is a REMUX: the Opus packets cross unchanged and
 * only the framing is rewritten. If that stopped being true the audio would
 * still play locally and be rejected by Meta in production, which is the failure
 * this file exists to prevent.
 */

/** An OpusHead for mono 48 kHz — the description a real recorder emits. */
const OPUS_HEAD = new Uint8Array([
  0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
  0x01, // version
  0x01, // channel count
  0x38, 0x01, // pre-skip
  0x80, 0xbb, 0x00, 0x00, // 48000 Hz
  0x00, 0x00, 0x00,
]);

type Fixture = { channels?: number; packets?: number; codec?: "opus" };

/** A recording shaped the way a browser's MediaRecorder produces one. */
async function record(format: "webm" | "ogg", opts: Fixture = {}): Promise<ArrayBuffer> {
  const channels = opts.channels ?? 1;
  const count = opts.packets ?? 25;

  const target = new BufferTarget();
  const output = new Output({
    format: format === "webm" ? new WebMOutputFormat() : new OggOutputFormat(),
    target,
  });
  const source = new EncodedAudioPacketSource("opus");
  output.addAudioTrack(source);
  await output.start();

  const description = new Uint8Array(OPUS_HEAD);
  description[9] = channels;
  const decoderConfig = { codec: "opus", numberOfChannels: channels, sampleRate: 48000, description };

  for (let i = 0; i < count; i++) {
    const data = new Uint8Array(80);
    data.fill(i % 251);
    data[0] = 0xfc;
    await source.add(
      new EncodedPacket(data, "key", i * 0.02, 0.02),
      i === 0 ? { decoderConfig: decoderConfig as unknown as AudioDecoderConfig } : undefined,
    );
  }
  await output.finalize();
  return target.buffer!;
}

function ascii(bytes: Uint8Array, length: number): string {
  return Buffer.from(bytes.slice(0, length)).toString("latin1");
}

describe("remuxToOggOpus", () => {
  it("turns a Chrome-shaped WebM recording into Ogg/Opus", async () => {
    const result = await remuxToOggOpus(await record("webm"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The two markers Meta's acceptance actually turns on.
    expect(ascii(result.bytes, 4)).toBe("OggS");
    expect(ascii(result.bytes, 64)).toContain("OpusHead");
    expect(result.channels).toBe(1);
    expect(result.sampleRate).toBe(48000);
  });

  it("produces something that parses back as mono Opus", async () => {
    const result = await remuxToOggOpus(await record("webm"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const back = new Input({
      source: new BufferSource(result.bytes.buffer as ArrayBuffer),
      formats: ALL_FORMATS,
    });
    const track = await back.getPrimaryAudioTrack();
    expect(await track?.getCodec()).toBe("opus");
    expect(track?.numberOfChannels).toBe(1);
  });

  it("passes an Ogg recording through the same path rather than special-casing it", async () => {
    // Firefox already records Ogg. One code path means one place for this to be
    // wrong, so the format that needs no conversion still goes through it.
    const result = await remuxToOggOpus(await record("ogg"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ascii(result.bytes, 4)).toBe("OggS");
  });

  it("refuses stereo instead of letting Meta reject it", async () => {
    // "OPUS codecs only; base audio/ogg not supported; mono input only" — a
    // stereo upload comes back as 131053 in production, with a message that
    // lists the legal formats without saying which one you sent.
    const result = await remuxToOggOpus(await record("webm", { channels: 2 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_mono");
  });

  it("reports junk as a failure rather than throwing", async () => {
    const result = await remuxToOggOpus(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("remux_failed");
  });

  it("reports an empty upload as a failure", async () => {
    const result = await remuxToOggOpus(new ArrayBuffer(0));
    expect(result.ok).toBe(false);
  });

  it("carries the Opus payload across unchanged — the point of a remux", async () => {
    // If this ever fails, something is decoding and re-encoding: quality drops,
    // the function gets slow enough to matter, and the reason the whole approach
    // fits in a serverless function has quietly gone away.
    const result = await remuxToOggOpus(await record("webm", { packets: 10 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const back = new Input({
      source: new BufferSource(result.bytes.buffer as ArrayBuffer),
      formats: ALL_FORMATS,
    });
    const track = await back.getPrimaryAudioTrack();
    expect(track).toBeTruthy();
    const { EncodedPacketSink } = await import("mediabunny");
    const sink = new EncodedPacketSink(track!);
    const seen: Uint8Array[] = [];
    for await (const p of sink.packets()) seen.push(p.data);

    expect(seen).toHaveLength(10);
    // Byte-for-byte what went in: first byte 0xfc, the rest the fill value.
    seen.forEach((data, i) => {
      expect(data.length).toBe(80);
      expect(data[0]).toBe(0xfc);
      expect(data[1]).toBe(i % 251);
    });
  });
});

describe("remuxFailureMessage", () => {
  it("says something a consultant can act on for every failure", () => {
    for (const reason of ["no_audio_track", "not_opus", "not_mono", "remux_failed"] as const) {
      const message = remuxFailureMessage(reason);
      expect(message.length).toBeGreaterThan(20);
      // No jargon: "opus", "remux" and "codec" are our vocabulary, not theirs.
      expect(message.toLowerCase()).not.toContain("remux");
      expect(message.toLowerCase()).not.toContain("opus");
    }
  });
});
