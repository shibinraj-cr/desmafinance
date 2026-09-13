/**
 * SOP version numbering.
 *
 * Versions are `major.minor`, rendered "V1.0". A revision picks its bump:
 *
 *   minor — a clarification: wording, an SLA tweak, a new escalation row.
 *   major — the process itself changed; anyone trained on the old one has to
 *           be retrained, so a major bump defaults to re-acknowledgement.
 *
 * The bump is the AUTHOR'S call, not something inferred from a diff: only the
 * person making the change knows whether it alters how the work is done. What
 * this module guarantees is that the label is derived, unique per SOP, and
 * monotonic — never that the author chose wisely.
 */

export type VersionBump = "minor" | "major";

export type VersionNumber = { major: number; minor: number };

/** "V1.0" — the one place the label format is decided. */
export function versionLabel(v: VersionNumber): string {
  return `V${v.major}.${v.minor}`;
}

/** The first version of a brand-new SOP. */
export function initialVersion(): VersionNumber {
  return { major: 1, minor: 0 };
}

/**
 * The next version after `from`, for the requested bump.
 *   minor: 1.2 → 1.3      major: 1.2 → 2.0
 */
export function nextVersion(from: VersionNumber, bump: VersionBump): VersionNumber {
  if (bump === "major") return { major: from.major + 1, minor: 0 };
  return { major: from.major, minor: from.minor + 1 };
}

/**
 * The next version that does not collide with any label already used by this
 * SOP. Deleting or abandoning a draft leaves its label spent — reusing it would
 * make two different documents share one label in the audit trail, so we skip
 * forward instead.
 */
export function nextFreeVersion(
  from: VersionNumber,
  bump: VersionBump,
  taken: readonly string[],
): VersionNumber {
  const used = new Set(taken);
  let candidate = nextVersion(from, bump);
  // Bounded: an SOP with 1000 revisions of one kind is not a real case, and an
  // unbounded loop on corrupt data would hang the request.
  for (let i = 0; i < 1000 && used.has(versionLabel(candidate)); i++) {
    candidate = nextVersion(candidate, bump);
  }
  return candidate;
}

/** Highest version among a set of rows — the one a revision branches from. */
export function latestVersion(
  versions: readonly VersionNumber[],
): VersionNumber {
  let best: VersionNumber = { major: 0, minor: 0 };
  for (const v of versions) {
    if (v.major > best.major || (v.major === best.major && v.minor > best.minor)) best = v;
  }
  return best.major === 0 ? initialVersion() : best;
}

/** Descending sort comparator — newest version first. */
export function compareVersionsDesc(a: VersionNumber, b: VersionNumber): number {
  if (a.major !== b.major) return b.major - a.major;
  return b.minor - a.minor;
}

/** Parse "V2.1" / "2.1" back into numbers. Null when it is not a version label. */
export function parseVersionLabel(label: string): VersionNumber | null {
  const m = /^v?(\d+)\.(\d+)$/i.exec(label.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}
