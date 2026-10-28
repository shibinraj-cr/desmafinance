/**
 * Meta ad identity from a lead's `extra` — the columns a Meta lead sheet carries
 * beyond name / email / phone, kept verbatim by the sheet ingest. Header
 * spelling varies with how the sheet was set up ("adset_name", "Ad set name",
 * "adset"), so keys are compared with case, spaces and punctuation removed. A
 * name is preferred over an id; an id alone is still enough to group by.
 *
 * Pure: shared by Sales Analysis and anything else that reads attribution.
 */
export type MetaAdLevel = "adset" | "ad";

const KEYS: Record<MetaAdLevel, { names: string[]; ids: string[] }> = {
  adset: { names: ["adsetname", "adset"], ids: ["adsetid"] },
  ad: { names: ["adname", "ad"], ids: ["adid"] },
};

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

export function metaAdField(extra: unknown, level: MetaAdLevel): string | null {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const byNorm = new Map<string, string>();
  for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) byNorm.set(norm(k), v.trim());
    else if (typeof v === "number") byNorm.set(norm(k), String(v));
  }
  const { names, ids } = KEYS[level];
  for (const k of names) {
    const v = byNorm.get(k);
    if (v) return v;
  }
  for (const k of ids) {
    const v = byNorm.get(k);
    if (v) return `id ${v}`;
  }
  return null;
}
