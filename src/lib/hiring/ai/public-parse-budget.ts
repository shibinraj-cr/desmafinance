import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/app-settings";

/**
 * A daily ceiling on résumé parses spent by the PUBLIC apply form.
 *
 * This is the only hard control on that endpoint, and the reason is worth
 * stating: rate limiting there is in-process memory, so it is per warm
 * serverless instance rather than global, and unlike the apply route there is
 * no database uniqueness downstream to make repeated calls pointless. Every
 * call costs credits. So the ceiling has to live where all instances can see
 * it — the database.
 *
 * Counting queries HiringAiCall rather than keeping a counter, so it cannot
 * drift, cannot be reset by a deploy, and agrees with the credits ledger by
 * construction.
 */
export const PUBLIC_PARSE_DAILY_CAP_KEY = "hiring_public_parse_daily_cap";
const DEFAULT_CAP = 200;

export async function getPublicParseCap(): Promise<number> {
  const raw = await getSetting(PUBLIC_PARSE_DAILY_CAP_KEY);
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CAP;
}

export async function setPublicParseCap(cap: number, userId?: string | null): Promise<void> {
  await setSetting(PUBLIC_PARSE_DAILY_CAP_KEY, String(Math.max(0, Math.floor(cap))), userId);
}

/** Parses spent by the public form since local midnight. */
export async function publicParsesToday(now = new Date()): Promise<number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return prisma.hiringAiCall.count({
    where: {
      feature: "resume_parse",
      entityType: PUBLIC_PARSE_ENTITY,
      createdAt: { gte: start },
    },
  });
}

/** Tags a call as having come from the public form, so it can be counted apart. */
export const PUBLIC_PARSE_ENTITY = "CareersApplyForm";

export async function publicParseAllowed(now = new Date()): Promise<boolean> {
  const [cap, used] = await Promise.all([getPublicParseCap(), publicParsesToday(now)]);
  return used < cap;
}
