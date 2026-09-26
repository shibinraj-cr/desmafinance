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
  ownerId: string | null;
  publishedAt: string | null;
  createdAt: string;
  tasks: MediaTaskDto[];
};
