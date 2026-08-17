"use client";

/**
 * An attachment inside a message bubble.
 *
 * Shared by the inbox and the lead page for one reason: a voice note that plays
 * in one and shows as a filename in the other is a bug report waiting to happen,
 * and these two threads have already drifted apart once.
 *
 * Everything is fetched from `/api/crm/wa/media/<messageId>`, never from the
 * provider directly. A Cloud API media URL expires within minutes and needs the
 * WABA token, so it cannot go in a `src` — and the imported Wabis URLs go
 * through the same route so the browser sees one origin and one permission
 * model, rather than a mixture that works for old messages and not new ones.
 */

type Props = {
  messageId: string;
  mediaMime: string | null;
  fileName: string | null;
  /** The message type Meta gave us, used when the mime is missing. */
  type: string;
};

function kindOf(mime: string | null, type: string): "audio" | "image" | "video" | "file" {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  // Wabis's imported rows often carry no mime at all, but the message type
  // survived the import — so the type is the fallback rather than a dead end.
  if (type === "audio" || type === "voice") return "audio";
  if (type === "image" || type === "sticker") return "image";
  if (type === "video") return "video";
  return "file";
}

export function WaAttachment({ messageId, mediaMime, fileName, type }: Props) {
  const src = `/api/crm/wa/media/${messageId}`;
  const kind = kindOf(mediaMime, type);

  if (kind === "audio") {
    return (
      <audio
        controls
        // Metadata only: a thread can hold dozens of voice notes, and fetching
        // every one on open would pull megabytes nobody asked for. The browser
        // gets the rest when someone presses play.
        preload="metadata"
        src={src}
        className="w-64 max-w-full h-10"
      />
    );
  }

  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- not a known-size
      // asset: this is a candidate's upload of arbitrary dimensions, served
      // from our own API, so next/image's optimiser has nothing to do here.
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img src={src} alt={fileName ?? "Attachment"} className="rounded-lg max-h-64 max-w-full object-contain" />
      </a>
    );
  }

  if (kind === "video") {
    return <video controls preload="metadata" src={src} className="rounded-lg max-h-64 max-w-full" />;
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-xs text-label-sm text-primary hover:underline"
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
        attach_file
      </span>
      {fileName || "Attachment"}
    </a>
  );
}
