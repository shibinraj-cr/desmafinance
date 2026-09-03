/**
 * Multi-select filter params.
 *
 * Every list filter in the app is expressed in the URL, and every one of them
 * accepts more than one value. The wire format is a *repeated* query param —
 * `?country=India&country=Nepal` — rather than a comma-joined single value,
 * because several filters are free text (campaign names, countries, study
 * destinations) and a value containing a comma would be silently split in half.
 *
 * A legacy single-value link (`?country=India`) parses to a one-element list,
 * so old bookmarks, saved exports and the drill-down links that pass a single
 * value keep working unchanged.
 */

/**
 * Read a repeatable filter param as a clean list: trims, drops empties and
 * de-dupes while preserving the order the user picked them in.
 *
 * Accepts the two shapes a param arrives in — Next's server `searchParams`
 * (`string | string[] | undefined`) and `URLSearchParams.getAll()` (`string[]`).
 */
export function listParam(v: string | string[] | undefined | null): string[] {
  if (v === undefined || v === null) return [];
  const raw = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * The single value of a param that stays single-valued (sort, page, a date).
 * If a caller somehow repeats it, the first one wins.
 */
export function oneParam(v: string | string[] | undefined | null): string | undefined {
  return listParam(v)[0];
}

/**
 * Prisma scalar filter for a multi-select: `undefined` when nothing is picked,
 * the bare value for exactly one (so the generated SQL stays an `=` and the
 * existing single-value tests still describe the shape), `{ in: [...] }` for
 * several.
 */
export function oneOf<T extends string>(values: T[]): T | { in: T[] } | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return { in: values };
}

/**
 * Apply a filter patch to `URLSearchParams` in place. A `string[]` becomes
 * repeated keys; `null`, `""` and `[]` remove the key entirely. Every key in
 * the patch is cleared first so a shrinking multi-select doesn't leave stale
 * repeats behind.
 */
export function applyFilterPatch(
  params: URLSearchParams,
  patch: Record<string, string | string[] | null>,
): void {
  for (const [k, v] of Object.entries(patch)) {
    params.delete(k);
    if (v === null || v === "") continue;
    if (Array.isArray(v)) {
      for (const item of listParam(v)) params.append(k, item);
    } else {
      params.set(k, v);
    }
  }
}
