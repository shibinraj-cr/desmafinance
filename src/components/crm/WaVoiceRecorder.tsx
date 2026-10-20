"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { microphoneErrorMessage } from "@/lib/wa/microphone";

/**
 * Record and send a WhatsApp voice note.
 *
 * The container the browser hands back is not our choice and not consistent:
 * Chrome produces WebM, Firefox Ogg. All that matters here is getting OPUS out
 * of it — the server republishes the packets as Ogg, which is the only
 * combination WhatsApp shows as a voice note rather than as a file attachment
 * with a music icon.
 *
 * Two capture settings are load-bearing rather than tuning. `channelCount: 1`
 * because Meta rejects stereo Ogg outright, and an explicit bitrate because
 * Chrome defaults audio-only recording to around 128 kbps — roughly eight times
 * what speech needs, enough to breach the upload limit on a long note, and well
 * past the 512 KB above which WhatsApp shows a download arrow instead of a play
 * button.
 *
 * THE RULE THIS FILE IS ORGANISED AROUND: a recording is sent only when somebody
 * asked for it to be sent. A WhatsApp message cannot be recalled, and every
 * other way a recorder can end — switching conversation, closing the tab,
 * changing your mind — must therefore throw the audio away. MediaRecorder does
 * not distinguish those cases on its own: stopping a stream's tracks flushes the
 * buffered audio and fires `stop` exactly as a deliberate press does, so the
 * distinction has to be carried explicitly.
 */

/**
 * In preference order, and deliberately WITHOUT `audio/mp4`.
 *
 * Safari before 18.4 can only record AAC in MP4, which is a genuine transcode
 * away from Opus rather than a repackaging — the server cannot convert it and
 * would reject it. Offering the button there means a consultant records forty
 * seconds of advice, presses stop, waits, and is then told their browser cannot
 * do this. Better to not offer it: `pickMimeType` returns null, the button never
 * appears, and nobody spends a minute talking to no one.
 */
const CANDIDATE_TYPES = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"];

/** Speech is intelligible far below music bitrates, and size is the constraint. */
const AUDIO_BITS_PER_SECOND = 24_000;

/** Long enough for a real answer, short enough to stay inside the upload limit. */
const MAX_SECONDS = 180;

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function WaVoiceRecorder({
  conversationId,
  disabled,
  onSent,
  onError,
}: {
  conversationId: string;
  disabled: boolean;
  onSent: () => void;
  onError: (message: string) => void;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** True only between "send this" and the recorder actually stopping. */
  const sendOnStopRef = useRef(false);
  /** Held across the await in `start`, so a second click cannot open a second mic. */
  const startingRef = useRef(false);

  // Probed once at mount rather than on click: a button that appears and then
  // fails is worse than one that never appeared. getUserMedia also needs a
  // secure context, so this is a genuine question even in a modern browser.
  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined" &&
        pickMimeType() !== null,
    );
  }, []);

  /**
   * Let go of the microphone and forget the recorder.
   *
   * Detaching the handlers first is the important part. Stopping the tracks
   * makes MediaRecorder flush whatever it buffered and fire `stop` — the same
   * events a deliberate press produces — so a live `onstop` here would upload a
   * recording nobody asked to send.
   */
  const teardown = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Already stopping. Nothing to do, and nothing worth reporting.
        }
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    // The browser's recording indicator stays lit until every track is stopped,
    // and a page still holding the microphone after you have finished speaking
    // is alarming regardless of what it is doing with it.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    sendOnStopRef.current = false;
    startingRef.current = false;
  }, []);

  /** False once this recorder is gone, so work in flight can notice. */
  const mountedRef = useRef(true);

  // Unmounting is a cancellation, never a send. The composer is keyed on the
  // thread, so switching conversation unmounts this — and a half-finished note
  // arriving on the candidate you just navigated away from is unrecallable.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  const upload = useCallback(
    async (blob: Blob) => {
      setSending(true);
      try {
        const form = new FormData();
        form.append("audio", blob, "voice-note");
        const res = await fetch(`/api/crm/wa/conversations/${conversationId}/audio`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { message?: string } | null;
          onError(payload?.message ?? "That voice note could not be sent.");
          return;
        }
        onSent();
      } catch {
        onError("That voice note could not be sent.");
      } finally {
        setSending(false);
      }
    },
    [conversationId, onSent, onError],
  );

  /** Stop and send what was recorded. The only path that delivers anything. */
  const stopAndSend = useCallback(() => {
    if (recorderRef.current?.state !== "recording") return;
    sendOnStopRef.current = true;
    recorderRef.current.stop();
    setRecording(false);
  }, []);

  /** Stop and bin it. Exists because "stop" meaning "send" is a trap. */
  const discard = useCallback(() => {
    teardown();
    setRecording(false);
    setSeconds(0);
  }, [teardown]);

  const start = useCallback(async () => {
    // `start` awaits a permission round trip, and until it resolves nothing has
    // set `recording` — so without this an ordinary impatient double-click opens
    // a second microphone and orphans the first, leaving the tab's recording
    // indicator lit for the life of the page.
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    onError("");

    const mimeType = pickMimeType();
    if (!mimeType) {
      startingRef.current = false;
      onError("This browser cannot record audio in a format WhatsApp accepts.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      startingRef.current = false;
      onError(microphoneErrorMessage(e));
      return;
    }

    // Unmounted while the permission prompt was open — which is easy to do, since
    // it blocks until answered. Hand the microphone straight back rather than
    // recording for a component nobody is looking at.
    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      startingRef.current = false;
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const send = sendOnStopRef.current;
      // `recorder.mimeType`, not the string we asked for: Firefox hands back Ogg
      // when asked for WebM, and the blob has to describe what it actually is or
      // the server parses the wrong container.
      const blob = send ? new Blob(chunksRef.current, { type: recorder.mimeType }) : null;
      teardown();
      setSeconds(0);
      if (blob && blob.size > 0) void upload(blob);
    };

    recorder.start();
    startingRef.current = false;
    setRecording(true);
    setSeconds(0);
    tickRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
  }, [onError, teardown, upload]);

  // The cap sends rather than discards: somebody who has been talking for three
  // minutes meant to say all of it, and silently binning it would be the worse
  // surprise. Driven off the rendered count rather than from inside the state
  // updater, where a side effect can run twice under StrictMode.
  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stopAndSend();
  }, [recording, seconds, stopAndSend]);

  // iOS suspends media capture when the tab goes to the background, which ends
  // the recording whatever we do. Finishing it deliberately means the part that
  // was captured still gets sent, rather than vanishing.
  useEffect(() => {
    if (!recording) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") stopAndSend();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [recording, stopAndSend]);

  if (supported === false) return null;

  const busy = sending || disabled;

  return (
    <div className="flex items-center gap-xs">
      {recording && (
        <button
          type="button"
          onClick={discard}
          aria-label="Discard recording"
          title="Discard"
          className="h-9 w-9 shrink-0 rounded-full grid place-items-center border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            close
          </span>
        </button>
      )}
      {recording && (
        <span className="text-label-sm text-error tabular-nums px-xs" role="timer" aria-live="off">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      )}
      <button
        type="button"
        onClick={recording ? stopAndSend : () => void start()}
        disabled={busy}
        aria-label={recording ? "Send voice note" : "Record a voice note"}
        title={recording ? "Send" : "Record a voice note"}
        className={
          "h-9 w-9 shrink-0 rounded-full grid place-items-center transition disabled:opacity-60 " +
          (recording
            ? "bg-error text-on-error"
            : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
        }
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {recording ? "send" : "mic"}
        </span>
      </button>
      {sending && <span className="text-label-sm text-on-surface-variant">Sending…</span>}
    </div>
  );
}
