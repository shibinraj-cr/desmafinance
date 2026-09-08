import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Marketing must keep sending as info@. Hiring must not.
 *
 * This is a wiring guarantee, not a behaviour one — the two senders resolve
 * identically until somebody configures hiring, so no runtime test would catch
 * a route being pointed at the wrong one. Only reading the imports does.
 */
const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const files = walk(SRC).map((f) => ({ path: f, body: readFileSync(f, "utf8") }));

/** Files that actually SEND, as opposed to reading config to display it. */
const senders = files.filter((f) => /\bsendEmail\s*\(/.test(f.body));

const rel = (p: string) => p.slice(process.cwd().length + 1).replace(/\\/g, "/");

describe("email sender isolation", () => {
  it("finds the send sites at all (guards against this test silently passing)", () => {
    expect(senders.length).toBeGreaterThan(4);
  });

  it("keeps every CRM/marketing send on the shared info@ account", () => {
    const crm = senders.filter((f) => /\/(crm|marketing)[/-]/.test(rel(f.path)));
    expect(crm.length).toBeGreaterThan(0);
    for (const f of crm) {
      expect(
        f.body.includes("getHiringEmailConfig"),
        `${rel(f.path)} must not use the hiring sender — marketing sends as info@`,
      ).toBe(false);
    }
  });

  it("sends every candidate-facing hiring email from the hiring sender", () => {
    const hiring = senders.filter((f) => /\/(hiring|careers)\//.test(rel(f.path)));
    expect(hiring.length).toBeGreaterThan(0);
    for (const f of hiring) {
      expect(
        f.body.includes("getHiringEmailConfig"),
        `${rel(f.path)} sends hiring mail but resolves the global sender`,
      ).toBe(true);
    }
  });
});
