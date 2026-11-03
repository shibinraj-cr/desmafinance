import { describe, it, expect } from "vitest";
import {
  addsChasedDetail,
  extractDetails,
  extractEmail,
  extractPhone,
  extractTypedName,
  matchQualification,
  missingDetails,
  newDetails,
  qualificationFromPayload,
  qualificationPayload,
} from "@/lib/ig/extract";

const QUALS = [
  { id: "q_gnm", label: "GNM" },
  { id: "q_bsc", label: "BSc Nursing" },
  { id: "q_pbsc", label: "Post BSc Nursing" },
  { id: "q_bach", label: "Bachelor's" },
  { id: "q_mast", label: "Master's" },
  { id: "q_other", label: "Others" },
];

describe("extractEmail", () => {
  it("finds an address mid-sentence and drops trailing punctuation", () => {
    expect(extractEmail("my email is Anjali.R@Gmail.com.")).toBe("Anjali.R@Gmail.com");
  });
  it("does not read an @mention as an address", () => {
    expect(extractEmail("saw your post on @desma.official")).toBeNull();
  });
  it("returns null when there is none", () => {
    expect(extractEmail("hi")).toBeNull();
    expect(extractEmail(null)).toBeNull();
  });
});

describe("extractPhone", () => {
  it("reads a bare Indian mobile as +91", () => {
    expect(extractPhone("9876543210")?.e164).toBe("+919876543210");
  });
  it("reads spaced, country-coded and trunk-prefixed forms", () => {
    expect(extractPhone("call me on +91 98765 43210")?.e164).toBe("+919876543210");
    expect(extractPhone("098765-43210")?.e164).toBe("+919876543210");
    expect(extractPhone("+971 50 123 4567")?.e164).toBe("+971501234567");
    expect(extractPhone("971501234567")?.e164).toBe("+971501234567");
  });
  it("keeps the number as typed alongside the normalised one", () => {
    expect(extractPhone("ph: 98765 43210")?.raw).toBe("98765 43210");
  });
  it("ignores years, dates and pin codes", () => {
    expect(extractPhone("passed out in 2019")).toBeNull();
    expect(extractPhone("joined 12-05-2024")).toBeNull();
    expect(extractPhone("pin 682001")).toBeNull();
  });
  it("does not lift a number out of an email address", () => {
    expect(extractPhone("anjali9876543210@gmail.com")).toBeNull();
  });
});

describe("matchQualification", () => {
  it("matches across dots and case", () => {
    expect(matchQualification("I completed b.sc nursing in 2020", QUALS)?.id).toBe("q_bsc");
    expect(matchQualification("gnm", QUALS)?.id).toBe("q_gnm");
  });
  it("prefers the longer label when both appear", () => {
    expect(matchQualification("Post BSc Nursing from Kerala", QUALS)?.id).toBe("q_pbsc");
  });
  it("matches a plural label by its singular", () => {
    expect(matchQualification("bachelor degree", QUALS)?.id).toBe("q_bach");
    expect(matchQualification("Masters in nursing", QUALS)?.id).toBe("q_mast");
  });
  it("never picks the catch-all from text", () => {
    expect(matchQualification("others", QUALS)).toBeNull();
  });
  it("needs whole words", () => {
    expect(matchQualification("I am a nurse", QUALS)).toBeNull();
    expect(matchQualification("signmore", QUALS)).toBeNull();
  });
});

describe("qualification buttons", () => {
  it("round-trips a payload to its option", () => {
    expect(qualificationFromPayload(qualificationPayload("q_gnm"), QUALS)?.label).toBe("GNM");
  });
  it("ignores a stale id and foreign payloads", () => {
    expect(qualificationFromPayload("desgro_qual:gone", QUALS)).toBeNull();
    expect(qualificationFromPayload("ICEBREAKER_FEES", QUALS)).toBeNull();
  });
  it("a tapped button beats the text", () => {
    expect(extractDetails({ text: "GNM", quickReplyPayload: qualificationPayload("q_bsc") }, QUALS).qualificationId).toBe("q_bsc");
  });
});

describe("extractTypedName", () => {
  it("reads the first item of a details message", () => {
    expect(extractTypedName("Anjali, 9876543210, anjali@gmail.com, BSc Nursing", QUALS)).toBe("Anjali");
    expect(extractTypedName("anjali mary\n9876543210", QUALS)).toBe("Anjali Mary");
  });
  it("reads an explicit name label", () => {
    expect(extractTypedName("Name: anjali mary", QUALS)).toBe("Anjali Mary");
    expect(extractTypedName("Name - Anjali", QUALS)).toBe("Anjali");
    expect(extractTypedName("my name is Anjali and my number is 9876543210", QUALS)).toBe("Anjali");
  });
  it("trims greetings and 'I am' off a details message", () => {
    expect(extractTypedName("Hi, I am Anjali, 9876543210", QUALS)).toBe("Anjali");
  });
  it("takes nothing from a message without a phone or email (unless labelled)", () => {
    expect(extractTypedName("I am interested", QUALS)).toBeNull();
    expect(extractTypedName("Thomas Cook", QUALS)).toBeNull();
  });
  it("does not mistake a qualification or a greeting for a name", () => {
    expect(extractTypedName("BSc Nursing, 9876543210", QUALS)).toBeNull();
    expect(extractTypedName("Hi sir 9876543210", QUALS)).toBeNull();
  });
  it("skips framing-only segments to reach the name", () => {
    expect(extractTypedName("9876543210, Anjali", QUALS)).toBe("Anjali");
    expect(extractTypedName("I want details, 9876543210, Anjali", QUALS)).toBe("Anjali");
    expect(extractTypedName("Hello sir, this is Anjali K, 9876543210", QUALS)).toBe("Anjali K");
  });
  it("stops at the first real segment — a later place is not the person", () => {
    expect(extractTypedName("Anjali, Kerala, 9876543210", QUALS)).toBe("Anjali");
    expect(extractTypedName("Planning for Australia, 9876543210, Anjali", QUALS)).toBeNull();
  });
});

describe("newDetails / missingDetails", () => {
  const empty = { typedName: null, email: null, phone: null, phoneE164: null, qualificationId: null };

  it("fills blanks from one message", () => {
    const found = extractDetails({ text: "Anjali, 9876543210, anjali@gmail.com, GNM" }, QUALS);
    expect(newDetails(empty, found)).toEqual({
      typedName: "Anjali",
      email: "anjali@gmail.com",
      phone: "9876543210",
      phoneE164: "+919876543210",
      qualificationId: "q_gnm",
    });
  });
  it("never overwrites what an earlier message gave", () => {
    const current = { ...empty, phone: "9876543210", phoneE164: "+919876543210" };
    const found = extractDetails({ text: "my friend's number is 9123456789" }, QUALS);
    expect(newDetails(current, found)).toEqual({});
  });
  it("lists what is still missing in asking order", () => {
    expect(missingDetails(empty)).toEqual(["phone", "email", "qualification"]);
    expect(missingDetails({ phoneE164: "+919876543210", email: null, qualificationId: "q" })).toEqual(["email"]);
  });
  it("a name alone is not a chased detail", () => {
    expect(addsChasedDetail({ typedName: "Anjali" })).toBe(false);
    expect(addsChasedDetail({ email: "a@b.co" })).toBe(true);
  });
});
