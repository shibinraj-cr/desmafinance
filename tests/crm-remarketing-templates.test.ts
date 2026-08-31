import { describe, it, expect } from "vitest";
import {
  buildTouchParams,
  formatTouchTemplates,
  parseTouchParams,
  parseTouchTemplates,
  parseTransport,
  resolveTouchParam,
} from "@/lib/crm-remarketing-templates";

/**
 * The Cloud API addresses a template by name AND language, and rejects a
 * mismatch outright. These four are not uniform — touch 1 is `en` while the rest
 * are `en_US` — so anything that normalises or assumes would break exactly one
 * touch, which is the hardest kind of breakage to notice.
 */
const REAL = [
  "touchpoint_one_remarketing:en",
  "touchpoint_two_remarketing:en_US",
  "touchpoint_three_remarketing:en_US",
  "touchpoint_four_remarketing:en_US",
].join("\n");

describe("parseTouchTemplates", () => {
  it("reads the real four, keeping each language exactly as given", () => {
    const parsed = parseTouchTemplates(REAL);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toEqual({ name: "touchpoint_one_remarketing", language: "en" });
    // The one that differs. Normalising these to a single language would send
    // touch 1 under a pair Meta has never approved.
    expect(parsed[1]?.language).toBe("en_US");
    expect(parsed[3]).toEqual({ name: "touchpoint_four_remarketing", language: "en_US" });
  });

  it("keeps an interior blank, because position IS the touch number", () => {
    const parsed = parseTouchTemplates("a:en\n\nc:en_US");
    expect(parsed).toHaveLength(3);
    expect(parsed[1]).toBeNull();
    // Touch 3 must still be touch 3, not shifted up into touch 2's place.
    expect(parsed[2]?.name).toBe("c");
  });

  it("survives a name that contains a colon", () => {
    expect(parseTouchTemplates("odd:name:en_US")[0]).toEqual({ name: "odd:name", language: "en_US" });
  });

  it("treats a line with no language as unconfigured rather than guessing one", () => {
    expect(parseTouchTemplates("justaname")[0]).toBeNull();
    expect(parseTouchTemplates("name:")[0]).toBeNull();
    expect(parseTouchTemplates(":en")[0]).toBeNull();
  });

  it("is empty on nothing", () => {
    expect(parseTouchTemplates(null)).toEqual([]);
    expect(parseTouchTemplates("")).toEqual([]);
  });

  it("round-trips", () => {
    expect(formatTouchTemplates(parseTouchTemplates(REAL))).toBe(REAL);
  });
});

describe("parseTouchParams", () => {
  it("reads a comma-separated token list per touch", () => {
    expect(parseTouchParams("name,agent\nfirst_name")).toEqual([["name", "agent"], ["first_name"]]);
  });

  it("is empty per touch when a line is blank", () => {
    expect(parseTouchParams("\nname")).toEqual([[], ["name"]]);
  });
});

const LEAD = {
  name: "Test Candidate",
  agent: "Test Agent",
  agentPhone: "+919000000001",
  service: "Nursing",
  source: "Meta Leads",
  country: "Ireland",
};

describe("resolveTouchParam", () => {
  it("takes just the first name where a template greets somebody", () => {
    expect(resolveTouchParam("first_name", LEAD)).toBe("Test");
    expect(resolveTouchParam("name", LEAD)).toBe("Test Candidate");
  });

  it("is null for a field the lead does not have", () => {
    expect(resolveTouchParam("country", { ...LEAD, country: null })).toBeNull();
    expect(resolveTouchParam("country", { ...LEAD, country: "   " })).toBeNull();
  });
});

describe("buildTouchParams", () => {
  it("needs nothing for a template with no variables", () => {
    const r = buildTouchParams({ variableCount: 0, tokens: [], from: LEAD });
    expect(r).toEqual({ ok: true, params: {} });
  });

  it("fills the variables positionally", () => {
    const r = buildTouchParams({ variableCount: 2, tokens: ["first_name", "agent"], from: LEAD });
    expect(r.ok && r.params).toEqual({ "1": "Test", "2": "Test Agent" });
  });

  it("refuses when fewer values are mapped than the template wants", () => {
    // Meta rejects a mismatched count outright, so this is a send that could
    // never have worked — better caught here than per candidate in production.
    const r = buildTouchParams({ variableCount: 2, tokens: ["name"], from: LEAD });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unmapped");
  });

  it("refuses a token it does not recognise instead of sending a blank", () => {
    const r = buildTouchParams({ variableCount: 1, tokens: ["nickname"], from: LEAD });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_token");
  });

  it("refuses rather than greet somebody by nothing at all", () => {
    // "Hi , about your application" sends perfectly happily and reports no
    // problem anywhere. That is the outcome worth failing to avoid.
    const r = buildTouchParams({ variableCount: 1, tokens: ["first_name"], from: { ...LEAD, name: null } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty_value");
  });

  it("ignores tokens beyond what the template asks for", () => {
    const r = buildTouchParams({ variableCount: 1, tokens: ["first_name", "agent"], from: LEAD });
    expect(r.ok && Object.keys(r.params)).toEqual(["1"]);
  });
});

describe("parseTransport", () => {
  it("only 'cloud' means cloud — everything else keeps the working transport", () => {
    expect(parseTransport("cloud")).toBe("cloud");
    expect(parseTransport("CLOUD")).toBe("cloud");
    expect(parseTransport("wabis")).toBe("wabis");
    expect(parseTransport("")).toBe("wabis");
    expect(parseTransport(null)).toBe("wabis");
    // A typo must not silently stop the drip, nor silently start a new one.
    expect(parseTransport("clod")).toBe("wabis");
  });
});
