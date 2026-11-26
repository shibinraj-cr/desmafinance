/**
 * Media Planner vocabulary shared by server and client code. Pure data — no
 * imports — so the planner's client component can use it without dragging
 * server-only modules into the browser bundle. Server helpers (access check,
 * Prisma include, serializers) live in ./media-plan, which re-exports this.
 */
export const MEDIA_PLANNER_HREF = "/marketing/media-planner";

/**
 * Every planner item is one post on one platform, filed under one content
 * category — the two axes the team plans by. A piece that goes out on four
 * platforms is four items (each with its own link, time and status).
 */
export const MEDIA_PLATFORM_CODES = ["youtube", "instagram", "facebook", "linkedin"] as const;
export type MediaPlatform = (typeof MEDIA_PLATFORM_CODES)[number];

/** Display metadata per platform. The chip color in the calendar is the platform's. */
export const MEDIA_PLATFORMS: Record<
  MediaPlatform,
  { label: string; pill: string; color: string }
> = {
  youtube: { label: "YouTube", pill: "YT", color: "#ff6b5e" },
  instagram: { label: "Instagram", pill: "IG", color: "#e86bd8" },
  facebook: { label: "Facebook", pill: "FB", color: "#6f8bff" },
  linkedin: { label: "LinkedIn", pill: "IN", color: "#33c3ff" },
};

export const MEDIA_CATEGORY_CODES = [
  "longform",
  "longform_cut",
  "anchoring",
  "animated_en",
  "animated_ml",
  "poster",
  "coding_en",
  "coding_ml",
] as const;
export type MediaCategory = (typeof MEDIA_CATEGORY_CODES)[number];

/** Category labels, in the team's own words; `short` fits a calendar chip. */
export const MEDIA_CATEGORIES: Record<MediaCategory, { label: string; short: string }> = {
  longform: { label: "Lengthy Videos", short: "Lengthy" },
  longform_cut: { label: "Reel Cut From Lengthy Videos", short: "Lengthy cut" },
  anchoring: { label: "Anchoring Reels/Shorts", short: "Anchoring" },
  animated_en: { label: "Animated Reels/Shorts English", short: "Animated EN" },
  animated_ml: { label: "Animated Reels/Shorts Malayalam", short: "Animated ML" },
  poster: { label: "Posters", short: "Poster" },
  coding_en: { label: "Coding Videos English", short: "Coding EN" },
  coding_ml: { label: "Coding Videos Malayalam", short: "Coding ML" },
};

/**
 * The older single "format" axis (YT Short / YT Video / Insta Reel / Poster).
 * Still stored — derived from platform + category — so older API clients and
 * the per-format checklist fallback keep working.
 */
export const MEDIA_FORMAT_CODES = ["short", "video", "reel", "poster"] as const;
export type MediaFormat = (typeof MEDIA_FORMAT_CODES)[number];

/** The format a platform + category pair stands for. */
export function deriveMediaFormat(platform: MediaPlatform, category: MediaCategory | null): MediaFormat {
  if (category === "poster") return "poster";
  if (category === "longform") return "video";
  return platform === "youtube" ? "short" : "reel";
}

/** Best-guess platform and category for a legacy format-only item or request. */
export function platformFromFormat(format: MediaFormat): MediaPlatform {
  return format === "short" || format === "video" ? "youtube" : "instagram";
}
export function categoryFromFormat(format: MediaFormat): MediaCategory | null {
  if (format === "video") return "longform";
  if (format === "poster") return "poster";
  return null;
}

export function platformMeta(platform: string): { label: string; pill: string; color: string } {
  return (
    MEDIA_PLATFORMS[platform as MediaPlatform] ?? {
      label: platform,
      pill: platform.slice(0, 2).toUpperCase(),
      color: "#9a9078",
    }
  );
}

export function categoryLabel(category: string | null | undefined, form: "label" | "short" = "label"): string {
  if (!category) return "Uncategorised";
  return MEDIA_CATEGORIES[category as MediaCategory]?.[form] ?? category;
}

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

/** Per-category checklist; uncategorised items fall back to the format's list. */
export const MEDIA_CATEGORY_CHECKLIST: Record<MediaCategory, string[]> = {
  longform: ["Script", "Shoot", "Edit", "Thumbnail", "Approval", "Publish"],
  longform_cut: ["Pick clip", "Edit", "Captions", "Approval", "Publish"],
  anchoring: ["Script", "Shoot", "Edit", "Approval", "Publish"],
  animated_en: ["Script", "Voice-over", "Animate", "Approval", "Publish"],
  animated_ml: ["Script", "Voice-over", "Animate", "Approval", "Publish"],
  poster: ["Design", "Approval", "Publish"],
  coding_en: ["Script", "Record", "Edit", "Approval", "Publish"],
  coding_ml: ["Script", "Record", "Edit", "Approval", "Publish"],
};

export function mediaChecklist(category: MediaCategory | null, format: MediaFormat): string[] {
  return category ? MEDIA_CATEGORY_CHECKLIST[category] : MEDIA_DEFAULT_CHECKLIST[format];
}

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
  /** Legacy axis, derived from platform + category. */
  format: string;
  platform: string;
  /** A MediaCategory code, or null for an item nobody has filed yet. */
  category: string | null;
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
