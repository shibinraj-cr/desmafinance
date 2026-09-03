import { describe, it, expect } from "vitest";
import {
  buildCreatePayload,
  buildEditPayload,
  buildTemplateComponentsPayload,
  isSequentialFromOne,
  normalizeTemplateName,
  renderSpecPreview,
  specFromMergeBody,
  templateVariableIndexes,
  validateTemplateSpec,
  type WaTemplateSpec,
} from "@/lib/wa/template-spec";
import { CRM_TEMPLATE_SAMPLE_VARS } from "@/lib/crm";

function spec(over: Partial<WaTemplateSpec> = {}): WaTemplateSpec {
  return {
    name: "follow_up",
    language: "en",
    category: "UTILITY",
    headerText: null,
    headerExample: null,
    body: "Hi {{1}}, your application has moved on.",
    bodyExamples: ["Priya Menon"],
    footer: null,
    buttons: [],
    ...over,
  };
}

describe("template names", () => {
  it("turns what a human says into what Meta accepts", () => {
    expect(normalizeTemplateName("Follow-up — no response")).toBe("follow_up_no_response");
    expect(normalizeTemplateName("AHPRA  Direct 2026!")).toBe("ahpra_direct_2026");
  });

  it("does not leave a leading or trailing underscore behind", () => {
    expect(normalizeTemplateName("  —hello—  ")).toBe("hello");
  });

  it("drops apostrophes rather than turning them into separators", () => {
    expect(normalizeTemplateName("Priya's offer")).toBe("priyas_offer");
  });
});

describe("variables", () => {
  it("counts distinct indexes, not occurrences", () => {
    expect(templateVariableIndexes("Hi {{1}}, {{1}} — see {{2}}")).toEqual([1, 2]);
  });

  it("returns them ascending whatever order they appear in", () => {
    expect(templateVariableIndexes("{{3}} {{1}} {{2}}")).toEqual([1, 2, 3]);
  });

  it("tolerates the spacing Meta's own docs use", () => {
    expect(templateVariableIndexes("{{ 1 }}")).toEqual([1]);
  });

  it("knows 1,2,3 from 1,3", () => {
    expect(isSequentialFromOne([1, 2, 3])).toBe(true);
    expect(isSequentialFromOne([1, 3])).toBe(false);
    expect(isSequentialFromOne([2])).toBe(false);
    expect(isSequentialFromOne([])).toBe(true);
  });
});

describe("validation — what Meta's API will refuse", () => {
  it("accepts a plain, well-formed template", () => {
    expect(validateTemplateSpec(spec()).errors).toEqual([]);
  });

  it("refuses a name Meta cannot store", () => {
    expect(validateTemplateSpec(spec({ name: "Follow Up" })).errors.join(" ")).toMatch(/lowercase/);
  });

  it("refuses a gap in the variable numbering", () => {
    const errors = validateTemplateSpec(spec({ body: "Hi {{1}} about {{3}}", bodyExamples: ["a", "b"] })).errors;
    expect(errors.join(" ")).toMatch(/no gaps/);
  });

  it("refuses a variable with no sample value, because Meta rejects the submission outright", () => {
    expect(validateTemplateSpec(spec({ bodyExamples: [] })).errors.join(" ")).toMatch(/sample value/);
  });

  it("refuses sample values with line breaks", () => {
    expect(validateTemplateSpec(spec({ bodyExamples: ["Priya\nMenon"] })).errors.join(" ")).toMatch(/line breaks/);
  });

  it("refuses a body over Meta's 1024 characters", () => {
    expect(validateTemplateSpec(spec({ body: "x".repeat(1025), bodyExamples: [] })).errors.join(" ")).toMatch(/longer than/);
  });

  it("refuses a footer with a variable in it", () => {
    expect(validateTemplateSpec(spec({ footer: "Sent by {{1}}" })).errors.join(" ")).toMatch(/footer can't contain variables/i);
  });

  it("refuses a header carrying more than one variable", () => {
    const errors = validateTemplateSpec(spec({ headerText: "{{1}} and {{2}}", headerExample: "x" })).errors;
    expect(errors.join(" ")).toMatch(/at most one variable/);
  });

  it("wants a sample for a header variable too", () => {
    expect(validateTemplateSpec(spec({ headerText: "Hi {{1}}" })).errors.join(" ")).toMatch(/needs a sample value/);
  });

  it("refuses two buttons that read the same, which Meta rejects without naming either", () => {
    const errors = validateTemplateSpec(
      spec({
        buttons: [
          { type: "QUICK_REPLY", text: "Yes" },
          { type: "QUICK_REPLY", text: "yes" },
        ],
      }),
    ).errors;
    expect(errors.join(" ")).toMatch(/both labelled/);
  });

  it("refuses a call button that is not in international format", () => {
    const errors = validateTemplateSpec(spec({ buttons: [{ type: "PHONE_NUMBER", text: "Call", phoneNumber: "9000000000" }] })).errors;
    expect(errors.join(" ")).toMatch(/international format/);
  });

  it("refuses a link button with no scheme", () => {
    const errors = validateTemplateSpec(spec({ buttons: [{ type: "URL", text: "Open", url: "desgro.in" }] })).errors;
    expect(errors.join(" ")).toMatch(/http/);
  });

  it("wants an example URL when the link carries a variable", () => {
    const errors = validateTemplateSpec(
      spec({ buttons: [{ type: "URL", text: "Open", url: "https://desgro.in/{{1}}" }] }),
    ).errors;
    expect(errors.join(" ")).toMatch(/example URL/);
  });
});

describe("validation — what reviewers refuse but the API accepts", () => {
  it("warns rather than blocks when the body ends with a variable", () => {
    const check = validateTemplateSpec(spec({ body: "Your consultant is {{1}}", bodyExamples: ["Aparna"] }));
    expect(check.errors).toEqual([]);
    expect(check.warnings.join(" ")).toMatch(/ends with a variable/);
  });

  it("warns about a body that starts with a variable", () => {
    const check = validateTemplateSpec(spec({ body: "{{1}}, your application moved on.", bodyExamples: ["Priya"] }));
    expect(check.errors).toEqual([]);
    expect(check.warnings.join(" ")).toMatch(/starts with a variable/);
  });

  it("warns about adjacent variables", () => {
    const check = validateTemplateSpec(spec({ body: "Hello {{1}} {{2}} welcome", bodyExamples: ["Priya", "Menon"] }));
    expect(check.errors).toEqual([]);
    expect(check.warnings.join(" ")).toMatch(/next to each other/);
  });
});

describe("the Graph payload", () => {
  it("orders components header, body, footer, buttons — Meta rejects any other order", () => {
    const components = buildTemplateComponentsPayload(
      spec({
        headerText: "Update",
        footer: "Desma",
        buttons: [{ type: "QUICK_REPLY", text: "Thanks" }],
      }),
    ) as { type: string }[];
    expect(components.map((c) => c.type)).toEqual(["HEADER", "BODY", "FOOTER", "BUTTONS"]);
  });

  it("nests body examples one level deeper than header examples", () => {
    const components = buildTemplateComponentsPayload(
      spec({ headerText: "Hi {{1}}", headerExample: "Priya" }),
    ) as { type: string; example?: { header_text?: string[]; body_text?: string[][] } }[];

    expect(components[0].example?.header_text).toEqual(["Priya"]);
    expect(components[1].example?.body_text).toEqual([["Priya Menon"]]);
  });

  it("omits the example block entirely when there are no variables", () => {
    const components = buildTemplateComponentsPayload(
      spec({ body: "Your documents are ready.", bodyExamples: [] }),
    ) as { type: string; example?: unknown }[];
    expect(components[0].example).toBeUndefined();
  });

  it("renames phoneNumber to Meta's phone_number", () => {
    const components = buildTemplateComponentsPayload(
      spec({ buttons: [{ type: "PHONE_NUMBER", text: "Call", phoneNumber: "+919000000000" }] }),
    ) as { type: string; buttons?: Record<string, unknown>[] }[];
    expect(components[1].buttons?.[0]).toMatchObject({ type: "PHONE_NUMBER", phone_number: "+919000000000" });
  });

  it("attaches an example only to a link that actually carries a variable", () => {
    const components = buildTemplateComponentsPayload(
      spec({
        buttons: [
          { type: "URL", text: "Plain", url: "https://desgro.in" },
          { type: "URL", text: "Coded", url: "https://desgro.in/{{1}}", urlExample: "https://desgro.in/abc" },
        ],
      }),
    ) as { buttons?: { example?: string[] }[] }[];
    expect(components[1].buttons?.[0].example).toBeUndefined();
    expect(components[1].buttons?.[1].example).toEqual(["https://desgro.in/abc"]);
  });

  it("carries name and language on create and neither on edit — Meta freezes both", () => {
    const create = buildCreatePayload(spec());
    expect(create).toMatchObject({ name: "follow_up", language: "en", category: "UTILITY" });
    expect(Object.keys(buildEditPayload(spec())).sort()).toEqual(["category", "components"]);
  });
});

describe("preview", () => {
  it("substitutes the sample values", () => {
    expect(renderSpecPreview(spec()).body).toBe("Hi Priya Menon, your application has moved on.");
  });

  it("leaves a placeholder visible when its sample is still blank", () => {
    expect(renderSpecPreview(spec({ bodyExamples: [""] })).body).toBe("Hi {{1}}, your application has moved on.");
  });
});

describe("carrying a CRM quick reply across", () => {
  it("converts merge fields to positional variables and lifts their samples", () => {
    const out = specFromMergeBody("Hi {name}, about your {service} application.", CRM_TEMPLATE_SAMPLE_VARS);
    expect(out.body).toBe("Hi {{1}}, about your {{2}} application.");
    expect(out.bodyExamples).toEqual(["Priya Menon", "AHPRA Direct"]);
  });

  it("reuses one index for a token repeated in the body", () => {
    const out = specFromMergeBody("{name}, {name} — your {service}", CRM_TEMPLATE_SAMPLE_VARS);
    expect(out.body).toBe("{{1}}, {{1}} — your {{2}}");
    expect(out.bodyExamples).toEqual(["Priya Menon", "AHPRA Direct"]);
  });

  it("leaves an unknown brace alone rather than inventing a variable nobody can fill", () => {
    const out = specFromMergeBody("Hi {name}, {not_a_field} here", CRM_TEMPLATE_SAMPLE_VARS);
    expect(out.body).toBe("Hi {{1}}, {not_a_field} here");
    expect(out.bodyExamples).toEqual(["Priya Menon"]);
  });

  it("produces something the validator accepts", () => {
    const out = specFromMergeBody("Hi {name}, your {service} application has moved on.", CRM_TEMPLATE_SAMPLE_VARS);
    expect(validateTemplateSpec(spec({ body: out.body, bodyExamples: out.bodyExamples })).errors).toEqual([]);
  });
});
