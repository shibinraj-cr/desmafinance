import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Messages API rejects several JSON Schema keywords in
 * `output_config.format.schema`, and it rejects the whole REQUEST when it sees
 * one — a 400 before the model is ever consulted.
 *
 * That is how every résumé in a 93-file import came back "couldn't read": the
 * schema carried `maxItems`, so no parse ever happened. Four features were
 * broken the same way and nobody could tell, because each one failed at the
 * transport and reported it as a per-file problem.
 *
 * Unit tests could not catch it — the schemas are only rejected by the real API,
 * and this repo has no key. So this scans the source instead. It is crude on
 * purpose: it covers files nobody has written yet.
 *
 * Per the structured-outputs docs, unsupported: maxItems, minimum, maximum,
 * minLength, maxLength, pattern. `minItems` is supported only for 0 and 1.
 */
const UNSUPPORTED = ["maxItems", "minimum", "maximum", "minLength", "maxLength", "pattern"];

function aiSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return aiSourceFiles(path);
    return e.isFile() && e.name.endsWith(".ts") ? [path] : [];
  });
}

const AI_DIR = join(process.cwd(), "src/lib/hiring/ai");
const files = aiSourceFiles(AI_DIR);

describe("AI output schemas only use keywords the API accepts", () => {
  it("finds the AI modules to check", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  for (const keyword of UNSUPPORTED) {
    it(`uses no \`${keyword}\` anywhere in an output schema`, () => {
      const offenders = files.filter((f) => {
        const src = readFileSync(f, "utf8");
        // `\bkeyword:` — the shape it takes inside a schema literal.
        return new RegExp(`\\b${keyword}\\s*:`).test(src);
      });
      expect(offenders.map((f) => f.replace(process.cwd() + "/", ""))).toEqual([]);
    });
  }

  it("uses `minItems` only with 0 or 1, the only values supported", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/\bminItems\s*:\s*(\d+)/g)) {
        if (Number(m[1]) > 1) bad.push(`${f.replace(process.cwd() + "/", "")}: minItems ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps every schema an object with additionalProperties false", () => {
    // The API requires it, and forgetting it is the other easy 400.
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.includes("const SCHEMA")) continue;
      expect(src, `${f} declares a SCHEMA without additionalProperties: false`).toContain(
        "additionalProperties: false",
      );
    }
  });
});
