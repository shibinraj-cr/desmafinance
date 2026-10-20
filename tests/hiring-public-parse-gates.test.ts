import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = join(process.cwd(), "src/app/api/careers/parse-resume/route.ts");
const src = readFileSync(ROUTE, "utf8");
const at = (needle: string) => src.indexOf(needle);

/**
 * The parse endpoint is public and every call costs credits. Unlike the apply
 * route there is no database uniqueness downstream to make repeated calls
 * pointless, so the ONLY thing standing between a scripted loop and the credit
 * balance is that each gate runs before the paid call.
 *
 * A source-order test, because no runtime test would catch a reorder: moving
 * the budget check below the parse still returns correct-looking responses. It
 * just bills for them.
 */
describe("public résumé parse — gate ordering", () => {
  const spend = at("await parseResumeBytes(");

  it("has a paid call to protect", () => {
    expect(spend).toBeGreaterThan(0);
  });

  const gates: [string, string][] = [
    ["careers site is public", "isCareersPublic()"],
    ["job exists and is live", "getPublicJob(slug)"],
    ["honeypot", 'skip("honeypot")'],
    ["dwell time", 'skip("too_fast")'],
    ["page-issued token", "verifyCareersToken("],
    ["per-IP rate limit", 'skip("rate_limited")'],
    ["daily budget", "publicParseAllowed()"],
    ["size cap", 'skip("too_large")'],
    ["PDF only", 'skip("not_pdf")'],
  ];

  for (const [name, marker] of gates) {
    it(`checks ${name} before spending a credit`, () => {
      const idx = at(marker);
      expect(idx, `${name} gate is missing entirely`).toBeGreaterThan(0);
      expect(idx, `${name} runs AFTER the paid parse`).toBeLessThan(spend);
    });
  }

  it("tags the call so public spend can be counted apart from staff spend", () => {
    // Without this the daily cap counts nothing and silently never trips.
    expect(src).toContain("PUBLIC_PARSE_ENTITY");
    expect(at("PUBLIC_PARSE_ENTITY")).toBeLessThan(at("confidence: parsed.confidence"));
  });

  it("never reports a refusal as an error to the applicant", () => {
    // Every gate returns skip(), which is a 200 with parsed:null — the form
    // falls back to being typed by hand. A 4xx here would show a stranger an
    // error for our cost problem.
    expect(src).toContain('function skip(reason: string): NextResponse');
    expect(src).toContain("parsed: null");
  });
});
