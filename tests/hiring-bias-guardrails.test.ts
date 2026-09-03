import { describe, it, expect } from "vitest";
import { scoringPayload, scrubIdentity, BIAS_GUARDRAIL_INSTRUCTION } from "@/lib/hiring/ai/redact";

/**
 * §4 calls these non-negotiable, so they are asserted rather than trusted:
 * a protected attribute must not be able to reach a scoring prompt.
 */
describe("bias guardrails", () => {
  const candidate = {
    currentTitle: "Sales Executive",
    currentEmployer: "Demo Consultancy",
    totalExperienceYears: 3,
    noticePeriodDays: 30,
    resumeText: "Name: A Person\nAge: 27\nGender: Female\nSkills: Malayalam, CRM",
    portfolioUrl: "https://example.com",
    linkedinUrl: "https://linkedin.com/in/someone",
  };

  it("passes through only experience, skills and answers", () => {
    const payload = scoringPayload(candidate, [{ question: "Why?", answer: "Because." }]);
    expect(Object.keys(payload).sort()).toEqual(
      ["answers", "currentEmployer", "currentTitle", "noticePeriodDays", "resumeText", "totalExperienceYears"].sort(),
    );
  });

  it("carries no name, age, gender, photo or address field at all", () => {
    const payload = scoringPayload(candidate, []);
    const json = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ["fullname", "email", "phone", "locationtext", "linkedinurl", "portfoliourl"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("strips the identity lines a résumé header spells out", () => {
    const payload = scoringPayload(candidate, []);
    expect(payload.resumeText).not.toContain("A Person");
    expect(payload.resumeText).not.toContain("27");
    expect(payload.resumeText).not.toContain("Female");
    // …while keeping what scoring is actually allowed to read.
    expect(payload.resumeText).toContain("Malayalam");
  });

  it("scrubs the same labels out of a candidate's own answers", () => {
    const payload = scoringPayload(candidate, [
      { question: "Tell us about you", answer: "Religion: none\nI have run a desk for three years." },
    ]);
    expect(payload.answers[0]!.answer).not.toContain("Religion: none");
    expect(payload.answers[0]!.answer).toContain("three years");
  });

  it("catches the labels regardless of case or spacing", () => {
    expect(scrubIdentity("  MARITAL STATUS : Married")).toBe("[redacted]");
    expect(scrubIdentity("d.o.b: 01/01/1999")).toBe("[redacted]");
    expect(scrubIdentity("Caste - Something")).toBe("[redacted]");
  });

  it("leaves ordinary prose alone", () => {
    const text = "I led a team of four and cut turnaround from 9 days to 4.";
    expect(scrubIdentity(text)).toBe(text);
  });

  it("handles null and empty text without throwing", () => {
    expect(scrubIdentity(null)).toBeNull();
    expect(scrubIdentity("")).toBe("");
  });

  it("states the rule in the prompt as well as enforcing it in code", () => {
    for (const attr of ["name", "age", "gender", "marital status", "religion", "caste", "photo", "address"]) {
      expect(BIAS_GUARDRAIL_INSTRUCTION.toLowerCase()).toContain(attr);
    }
  });
});
