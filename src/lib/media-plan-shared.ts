/**
 * Media Planner vocabulary shared by server and client code. Pure data — no
 * imports — so the planner's client component can use it without dragging
 * server-only modules into the browser bundle. Server helpers (access check,
 * Prisma include, serializers) live in ./media-plan, which re-exports this.
 */
export const MEDIA_PLANNER_HREF = "/marketing/media-planner";

export const MEDIA_FORMAT_CODES = ["short", "video", "reel", "poster"] as const;
export type MediaFormat = (typeof MEDIA_FORMAT_CODES)[number];

/** Display metadata per format. Colors are the Lead Pulse data accents. */
export const MEDIA_FORMATS: Record<
  MediaFormat,
  { label: string; pill: string; color: string }
> = {
  short: { label: "YT Short", pill: "YT SHORT", color: "#ffb693" },
  video: { label: "YT Video", pill: "YT VIDEO", color: "#ffb4ab" },
  reel: { label: "Insta Reel", pill: "REEL", color: "#8B7BFF" },
  poster: { label: "Poster", pill: "POSTER", color: "#33e4ff" },
};

export const MEDIA_ITEM_STATUSES = [
  "idea",
  "script",
  "shoot",
  "edit",
  "approval",
  "scheduled",
  "published",
] as const;
export type MediaItemStatus = (typeof MEDIA_ITEM_STATUSES)[number];

export const MEDIA_STATUS_LABELS: Record<MediaItemStatus, string> = {
  idea: "Idea",
  script: "Script",
  shoot: "Shoot",
  edit: "Edit",
  approval: "Approval",
  scheduled: "Scheduled",
  published: "Published",
};

/**
 * The standard production checklist seeded when an item is created. The
 * "Publish" step inherits the item's publish date so the reminder cron has a
 * due date to fire on; the rest are left undated for the owner to plan.
 */
export const MEDIA_DEFAULT_CHECKLIST: Record<MediaFormat, string[]> = {
  short: ["Script", "Shoot", "Edit", "Approval", "Publish"],
  video: ["Script", "Shoot", "Edit", "Thumbnail", "Approval", "Publish"],
  reel: ["Script", "Shoot", "Edit", "Approval", "Publish"],
  poster: ["Design", "Approval", "Publish"],
};

/**
 * Weekly output targets the cadence tracker measures against. Deliberate
 * constants, not a settings table — the team revises them in a PR, the same
 * way the L2 scorecard weights are kept.
 */
export const MEDIA_WEEKLY_TARGETS: Record<MediaFormat, number> = {
  reel: 3,
  short: 2,
  video: 1,
  poster: 2,
};

export type MediaTaskDto = {
  id: string;
  name: string;
  seq: number;
  dueDate: string | null;
  status: string;
  assignedToId: string | null;
  doneAt: string | null;
};

export type MediaItemDto = {
  id: string;
  title: string;
  format: string;
  status: string;
  publishDate: string | null;
  publishTime: string | null;
  shootDate: string | null;
  hook: string | null;
  /** The post's URL (YouTube, Instagram, LinkedIn…), if one is known. */
  link: string | null;
  /**
   * Where the calendar gets the cover image: the uploaded thumbnail when there
   * is one, otherwise YouTube's own thumbnail for a YouTube link (which only
   * resolves once the video is public — the UI hides the image if it fails).
   */
  thumbnailUrl: string | null;
  /** True when thumbnailUrl is an uploaded image rather than a YouTube fallback. */
  hasUploadedThumbnail: boolean;
  ownerId: string | null;
  publishedAt: string | null;
  createdAt: string;
  tasks: MediaTaskDto[];
};

/** Accepted thumbnail uploads — a cover frame, so small. */
export const MEDIA_THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MEDIA_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The 11-character video id in a YouTube URL (watch, shorts, youtu.be, embed,
 * live), or null for anything else. Used to show YouTube's own thumbnail.
 */
export function youtubeVideoId(link: string | null | undefined): string | null {
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  const ID = /^[A-Za-z0-9_-]{11}$/;
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "studio.youtube.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|video)\/([^/]+)/);
      id = m ? m[1] : null;
    }
  }
  return id && ID.test(id) ? id : null;
}

/** Only http(s) links are stored, so a javascript: URL can never be rendered as a link. */
export function isSafeHttpUrl(link: string): boolean {
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Short platform name for a link, shown on the open-link button. */
export function linkPlatform(link: string | null | undefined): string {
  if (!link) return "";
  try {
    const host = new URL(link).hostname.replace(/^(www\.|m\.)/, "");
    if (host === "youtu.be" || host.endsWith("youtube.com")) return "YouTube";
    if (host.endsWith("instagram.com")) return "Instagram";
    if (host.endsWith("facebook.com") || host === "fb.watch") return "Facebook";
    if (host.endsWith("linkedin.com")) return "LinkedIn";
    return host;
  } catch {
    return "";
  }
}
