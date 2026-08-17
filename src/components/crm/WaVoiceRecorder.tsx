"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { microphoneErrorMessage } from "@/lib/wa/microphone";

/**
 * Record and send a WhatsApp voice note.
 *
 * The container the browser hands back is not our choice and not consistent:
 * Chrome produces WebM, Firefox Ogg, Safari MP4. All that matters here is
 * getting OPUS out of it — the server republishes the packets as Ogg, which is
 * the only combination WhatsApp will show as a voice note rather than as a file
 * attachment with a music icon.
 *
 * Two capture settings are load-bearing rather than tuning. `channelCount: 1`
 * because Meta rejects stereo Ogg outright, and an explicit bitrate because
 * Chrome defaults audio-only recording to around 128 kbps — roughly eight times
 * what speech needs, enough to breach the upload limit on a long note, and well
 * past the 512 KB above which WhatsApp shows a download arrow instead of a play
 * button.
 */

/** In preference order. Ogg first: it is what the server wants and skips a step. */
const CANDIDATE_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

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

  const releaseMic = useCallback(() => {
    // The browser's recording indicator stays lit until every track is stopped,
    // and a page that keeps the microphone open after you have finished speaking
    // is alarming regardless of what it is doing with it.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => releaseMic, [releaseMic]);

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

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    onError("");
    const mimeType = pickMimeType();
    if (!mimeType) {
      onError("This browser cannot record audio in a format WhatsApp accepts.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      onError(microphoneErrorMessage(e));
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
      releaseMic();
      // `recorder.mimeType`, not the string we asked for: Firefox will hand back
      // Ogg when asked for WebM, and the blob has to describe what it actually
      // is or the server parses the wrong container.
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      chunksRef.current = [];
      if (blob.size > 0) void upload(blob);
    };

    recorder.start();
    setRecording(true);
    setSeconds(0);
    tickRef.current = setInterval(() => {
      setSeconds((s) => {
        // Stopping at the cap KEEPS what was said rather than discarding it —
        // the same reason a backgrounded tab finishes the note instead of losing
        // it. Nobody wants to be told their two minutes went nowhere.
        if (s + 1 >= MAX_SECONDS) stop();
        return s + 1;
      });
    }, 1000);
  }, [onError, releaseMic, upload, stop]);

  // iOS suspends media capture when the tab goes to the background, which ends
  // the recording whatever we do. Finishing it deliberately means the part that
  // was captured still gets sent.
  useEffect(() => {
    if (!recording) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [recording, stop]);

  if (supported === false) return null;

  const busy = sending || disabled;

  return (
    <div className="flex items-center gap-sm">
      <button
        type="button"
        onClick={recording ? stop : () => void start()}
        disabled={busy}
        aria-label={recording ? "Stop and send voice note" : "Record a voice note"}
        title={recording ? "Stop and send" : "Record a voice note"}
        className={
          "h-9 w-9 shrink-0 rounded-full grid place-items-center transition disabled:opacity-60 " +
          (recording
            ? "bg-error text-on-error animate-pulse"
            : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
        }
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {recording ? "stop" : "mic"}
        </span>
      </button>
      {recording && (
        <span className="text-label-sm text-error tabular-nums" role="timer" aria-live="off">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          <span className="text-on-surface-variant"> / {Math.floor(MAX_SECONDS / 60)}:00</span>
        </span>
      )}
      {sending && <span className="text-label-sm text-on-surface-variant">Sending…</span>}
    </div>
  );
}
