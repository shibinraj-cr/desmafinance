import { describe, it, expect } from "vitest";
import {
  isFormQualificationQuestion,
  qualificationFromFormAnswer,
  qualificationFromForm,
} from "@/lib/crm-form-qualification";

// The prod list, as of Nov 2026.
const QUALS = [
  { id: "q-gnm", label: "GNM" },
  { id: "q-gcn", label: "GCN/GDN/GCAN" },
  { id: "q-bsn", label: "BSN" },
  { id: "q-msn", label: "MSN" },
  { id: "q-pbsn", label: "PBSN" },
  { id: "q-plus2", label: "Plus Two" },
  { id: "q-ahpra", label: "AHPRA RN" },
  { id: "q-other", label: "Other" },
];

describe("isFormQualificationQuestion", () => {
  it("recognises every spelling Meta has sent", () => {
    expect(isFormQualificationQuestion("What is your qualification?")).toBe(true);
    expect(isFormQualificationQuestion("What is your current qualification?")).toBe(true);
    expect(isFormQualificationQuestion("what_is_your_current_qualification?")).toBe(true);
    expect(isFormQualificationQuestion(" what is your qualification ")).toBe(true);
  });

  it("leaves the plus-two form and unrelated columns alone", () => {
    expect(isFormQualificationQuestion("Educational Qualification?")).toBe(false);
    expect(isFormQualificationQuestion("qualificationRaw")).toBe(false);
    expect(isFormQualificationQuestion("Are You a GNM Nurse?")).toBe(false);
    expect(isFormQualificationQuestion("Job Title")).toBe(false);
  });
});

describe("qualificationFromFormAnswer — the Meta option keys", () => {
  it.each([
    ["bsn", "q-bsn"],
    ["gnm", "q-gnm"],
    ["pbsc", "q-pbsn"], // Post BSc is recorded as PBSN
    ["msn", "q-msn"],
    ["others", "q-other"],
    ["BSN", "q-bsn"],
    [" Gnm ", "q-gnm"],
  ])("%s → %s", (answer, id) => {
    expect(qualificationFromFormAnswer(answer, QUALS)?.id).toBe(id);
  });

  it("accepts the spelled-out degrees too", () => {
    expect(qualificationFromFormAnswer("B.Sc Nursing", QUALS)?.id).toBe("q-bsn");
    expect(qualificationFromFormAnswer("Post B.Sc Nursing", QUALS)?.id).toBe("q-pbsn");
    expect(qualificationFromFormAnswer("M.Sc Nursing", QUALS)?.id).toBe("q-msn");
    expect(qualificationFromFormAnswer("General Nursing", QUALS)?.id).toBe("q-gnm");
  });

  it("matches any other option that is a label on the list", () => {
    expect(qualificationFromFormAnswer("ahpra_rn", QUALS)?.id).toBe("q-ahpra");
    expect(qualificationFromFormAnswer("gcn_gdn_gcan", QUALS)?.id).toBe("q-gcn");
  });

  it("finds the catch-all whether it is called Other or Others", () => {
    expect(qualificationFromFormAnswer("other", [{ id: "x", label: "Others" }])?.id).toBe("x");
  });

  it("leaves answers that name no qualification blank", () => {
    for (const a of ["yes", "no", "not_sure", "", "  ", null, undefined, "I have 3 years experience"]) {
      expect(qualificationFromFormAnswer(a, QUALS)).toBeNull();
    }
  });

  it("leaves it blank when the mapped qualification is not on the list (or inactive)", () => {
    const noPbsn = QUALS.filter((q) => q.label !== "PBSN");
    expect(qualificationFromFormAnswer("pbsc", noPbsn)).toBeNull();
    expect(qualificationFromFormAnswer("others", [{ id: "q-bsn", label: "BSN" }])).toBeNull();
  });
});

describe("qualificationFromForm — reading a lead's extra columns", () => {
  it("picks the qualification answer out of a Meta row", () => {
    const extra = {
      campaign: "GF | Kerala | Nov 2026",
      "Campaign Name": "GF-Kerala",
      "What is your qualification?": "pbsc",
      City: "ktm",
    };
    expect(qualificationFromForm(extra, QUALS)?.id).toBe("q-pbsn");
  });

  it("is blank when the form didn't ask, or the answer names nothing", () => {
    expect(qualificationFromForm({ campaign: "X", City: "tvm" }, QUALS)).toBeNull();
    expect(qualificationFromForm({ "What is your qualification?": "yes" }, QUALS)).toBeNull();
    expect(qualificationFromForm(null, QUALS)).toBeNull();
  });

  it("ignores the plus-two form's free-typed answer", () => {
    expect(qualificationFromForm({ "Educational Qualification?": "Plus Two" }, QUALS)).toBeNull();
  });
});
