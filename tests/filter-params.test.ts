import { describe, it, expect } from "vitest";
import { listParam, oneParam, oneOf, applyFilterPatch } from "../src/lib/filter-params";

describe("listParam", () => {
  it("reads a legacy single value as a one-element list", () => {
    expect(listParam("India")).toEqual(["India"]);
  });

  it("reads repeated params in the order they were picked", () => {
    expect(listParam(["India", "Nepal"])).toEqual(["India", "Nepal"]);
  });

  it("trims, drops empties and de-dupes", () => {
    expect(listParam([" India ", "", "India", "  ", "Nepal"])).toEqual(["India", "Nepal"]);
  });

  it("is empty for undefined/null", () => {
    expect(listParam(undefined)).toEqual([]);
    expect(listParam(null)).toEqual([]);
  });

  it("does NOT split on commas — a campaign name may contain one", () => {
    expect(listParam("Nursing, Australia")).toEqual(["Nursing, Australia"]);
  });
});

describe("oneParam", () => {
  it("takes the first value when a single-valued param is repeated", () => {
    expect(oneParam(["created_desc", "name_asc"])).toBe("created_desc");
    expect(oneParam(undefined)).toBeUndefined();
  });
});

describe("oneOf", () => {
  it("is undefined when nothing is picked", () => {
    expect(oneOf([])).toBeUndefined();
  });

  it("stays a bare equality for one value", () => {
    expect(oneOf(["a"])).toBe("a");
  });

  it("becomes an IN for several", () => {
    expect(oneOf(["a", "b"])).toEqual({ in: ["a", "b"] });
  });
});

describe("applyFilterPatch", () => {
  it("writes a list as repeated keys", () => {
    const p = new URLSearchParams();
    applyFilterPatch(p, { country: ["India", "Nepal"] });
    expect(p.toString()).toBe("country=India&country=Nepal");
  });

  it("clears stale repeats when the selection shrinks", () => {
    const p = new URLSearchParams("country=India&country=Nepal&page=2");
    applyFilterPatch(p, { country: ["Nepal"] });
    expect(p.getAll("country")).toEqual(["Nepal"]);
    expect(p.get("page")).toBe("2");
  });

  it("removes the key for null, empty string and empty list", () => {
    const p = new URLSearchParams("a=1&b=2&c=3");
    applyFilterPatch(p, { a: null, b: "", c: [] });
    expect(p.toString()).toBe("");
  });

  it("leaves other keys untouched", () => {
    const p = new URLSearchParams("q=priya&status=x");
    applyFilterPatch(p, { status: ["y", "z"] });
    expect(p.get("q")).toBe("priya");
    expect(p.getAll("status")).toEqual(["y", "z"]);
  });
});
