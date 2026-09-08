import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TALENT_POOL_STATES,
  TALENT_POOL_STATE_LABELS,
  TALENT_POOL_CLOSED_STATES,
} from "@/lib/hiring/constants";

const MIGRATION = join(
  process.cwd(),
  "prisma/migrations/20260907120000_hiring_talent_pool_stages/migration.sql",
);

/** The states this table used before the pool became a set of working stages. */
const LEGACY_STATES = ["new", "nurturing", "re_engage", "placed", "cold"];

describe("talent pool stages", () => {
  it("labels every state", () => {
    for (const s of TALENT_POOL_STATES) {
      expect(TALENT_POOL_STATE_LABELS[s], `no label for ${s}`).toBeTruthy();
    }
  });

  it("treats only real states as closed", () => {
    for (const s of TALENT_POOL_CLOSED_STATES) {
      expect(TALENT_POOL_STATES).toContain(s);
    }
  });

  /**
   * The dangerous failure here is silent: a row left on a state no filter chip
   * can select disappears from the page while still existing in the table. So
   * the migration must move every legacy value somewhere real.
   */
  it("migrates every legacy state to one that still exists", () => {
    const sql = readFileSync(MIGRATION, "utf8");

    for (const legacy of LEGACY_STATES) {
      const stillValid = (TALENT_POOL_STATES as readonly string[]).includes(legacy);
      const remapped = sql.includes(`'${legacy}'`);
      expect(
        stillValid || remapped,
        `'${legacy}' is neither a current state nor remapped by the migration`,
      ).toBe(true);
    }
  });

  it("only ever writes states the app can display", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const written = [...sql.matchAll(/SET "state" = '([a-z_]+)'/g)].map((m) => m[1]!);

    expect(written.length).toBeGreaterThan(0);
    for (const w of written) {
      expect(TALENT_POOL_STATES, `migration writes unknown state '${w}'`).toContain(w);
    }
  });

  it("guards the catch-all against the current state list drifting", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    // The final sweep lists every valid state; if a state is added later and
    // not listed here, that sweep would wrongly reset rows holding it.
    const sweep = sql.slice(sql.indexOf('NOT IN'));
    for (const s of TALENT_POOL_STATES) {
      expect(sweep, `'${s}' missing from the migration's catch-all`).toContain(`'${s}'`);
    }
  });
});
