import { prisma } from "@/lib/prisma";
import { badRequest, unprocessable } from "@/lib/http-error";
import { getAiProvider } from "./provider";
import { meter } from "./credits";

/**
 * Company profile ingestion (§4.1). Paste the company website, fetch it, and
 * summarise it into a stored profile that conditions every later draft and
 * score — so generated copy sounds like DESMA rather than like a generic ATS.
 */

export type CompanyProfile = { summaryMd: string; tone: string | null; values: string[] };

/** The active profile, or null. Callers treat null as "no conditioning". */
export async function loadCompanyProfile(): Promise<CompanyProfile | null> {
  const row = await prisma.hiringCompanyProfile.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return null;
  return { summaryMd: row.summaryMd, tone: row.tone, values: row.values };
}

/** Rendered into a system prompt. Empty string when there is no profile. */
export function profilePreamble(profile: CompanyProfile | null): string {
  if (!profile) return "";
  return (
    `\n\nAbout the company you are writing for:\n${profile.summaryMd}` +
    (profile.tone ? `\n\nTone to write in: ${profile.tone}` : "") +
    (profile.values.length ? `\n\nValues: ${profile.values.join(", ")}` : "")
  );
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summaryMd", "tone", "values"],
  properties: {
    summaryMd: {
      type: "string",
      description: "150-250 words on what the company does, who it serves, and how it works.",
    },
    tone: { type: "string", description: "One short phrase describing how the company writes." },
    values: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
} as const;

/**
 * Fetch a public page and summarise it. Deliberately a plain fetch with a short
 * timeout and a size cap: this runs on a serverless function with a 60s ceiling,
 * and a company site that hangs must not take the request down with it.
 */
export async function ingestCompanyProfile(opts: {
  url: string;
  userId: string;
}): Promise<CompanyProfile> {
  const provider = getAiProvider();
  if (!provider) {
    throw unprocessable(
      "No AI key is configured, so the site cannot be summarised. Write the profile by hand instead.",
      "ai_disabled",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(opts.url);
  } catch {
    throw badRequest("That is not a valid URL.", "bad_url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw badRequest("Only http(s) URLs can be fetched.", "bad_url");
  }

  const html = await fetchPage(parsed.toString());
  const text = htmlToText(html).slice(0, 40_000);
  if (text.length < 200) {
    throw unprocessable(
      "That page had almost no readable text — paste the profile in by hand instead.",
      "empty_page",
    );
  }

  const result = await meter({ feature: "company_profile", userId: opts.userId }, () =>
    provider.generateJson({
      system:
        "You summarise a company's own website into a factual profile used to condition " +
        "recruitment copy. Use only what the page says. Do not invent awards, headcount, " +
        "funding or claims that are not on the page.",
      user: `Source: ${parsed.toString()}\n\n${text}`,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 2000,
    }),
  );

  const data = result.data as { summaryMd?: string; tone?: string; values?: string[] };
  if (!data.summaryMd?.trim()) {
    throw unprocessable("The summary came back empty. Try again, or write it by hand.", "empty_summary");
  }

  const profile: CompanyProfile = {
    summaryMd: data.summaryMd.trim(),
    tone: data.tone?.trim() || null,
    values: (data.values ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 6),
  };

  // One active profile at a time; older ones are kept but deactivated, so a bad
  // ingest can be rolled back to the previous text.
  await prisma.$transaction([
    prisma.hiringCompanyProfile.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    prisma.hiringCompanyProfile.create({
      data: {
        sourceUrl: parsed.toString(),
        summaryMd: profile.summaryMd,
        tone: profile.tone,
        values: profile.values,
        isActive: true,
        updatedById: opts.userId,
      },
    }),
  ]);

  return profile;
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "DesgroHiring/1.0 (+https://desgro.in)" },
      redirect: "follow",
    });
    if (!res.ok) throw unprocessable(`That page returned ${res.status}.`, "fetch_failed");
    const body = await res.text();
    return body.slice(0, 400_000);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw unprocessable("That site took too long to respond.", "fetch_timeout");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Crude but sufficient: strip scripts/styles/tags and collapse whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
