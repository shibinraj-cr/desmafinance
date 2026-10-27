import { describe, it, expect } from "vitest";
import { isFacebookOrigin, parseEmbeddedSignupMessage } from "@/lib/wa/embedded-signup";
import { parseCoexistenceNumbers, upsertCoexistenceNumber, type CoexistenceNumber } from "@/lib/wa/coexistence";

describe("isFacebookOrigin", () => {
  it("accepts facebook.com and its subdomains over https", () => {
    expect(isFacebookOrigin("https://www.facebook.com")).toBe(true);
    expect(isFacebookOrigin("https://web.facebook.com")).toBe(true);
    expect(isFacebookOrigin("https://facebook.com")).toBe(true);
  });

  // Meta's sample checks endsWith('facebook.com'), which this lookalike passes.
  it("rejects a lookalike domain, plain http and junk", () => {
    expect(isFacebookOrigin("https://evilfacebook.com")).toBe(false);
    expect(isFacebookOrigin("http://www.facebook.com")).toBe(false);
    expect(isFacebookOrigin("not a url")).toBe(false);
  });
});

describe("parseEmbeddedSignupMessage", () => {
  const coexistence = {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    version: 3,
    data: { waba_id: "111222333", phone_number_id: "444555666", business_id: "777" },
  };

  it("reads a Coexistence finish, sent as a JSON string", () => {
    expect(parseEmbeddedSignupMessage(JSON.stringify(coexistence))).toEqual({
      kind: "finish",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      coexistence: true,
      wabaId: "111222333",
      phoneNumberId: "444555666",
      businessId: "777",
    });
  });

  it("reads the same message sent as an object", () => {
    expect(parseEmbeddedSignupMessage(coexistence)?.kind).toBe("finish");
  });

  it("flags an ordinary finish as not Coexistence", () => {
    const parsed = parseEmbeddedSignupMessage({ ...coexistence, event: "FINISH" });
    expect(parsed).toMatchObject({ kind: "finish", coexistence: false });
  });

  it("keeps a finish that is missing ids, with nulls, so the page can say so", () => {
    expect(parseEmbeddedSignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: {} })).toMatchObject({
      kind: "finish",
      wabaId: null,
      phoneNumberId: null,
    });
  });

  it("reads a cancel with the step it was abandoned at", () => {
    expect(
      parseEmbeddedSignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } }),
    ).toEqual({ kind: "cancel", currentStep: "PHONE_NUMBER_SETUP", errorMessage: null, errorCode: null });
  });

  it("ignores the SDK's own chatter and anything unparseable", () => {
    expect(parseEmbeddedSignupMessage("cb=f1234&type=resize")).toBeNull();
    expect(parseEmbeddedSignupMessage({ type: "SOMETHING_ELSE", event: "FINISH" })).toBeNull();
    expect(parseEmbeddedSignupMessage(null)).toBeNull();
    expect(parseEmbeddedSignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "PROGRESS" })).toBeNull();
  });
});

describe("coexistence number list", () => {
  function entry(over: Partial<CoexistenceNumber> & { phoneNumberId: string }): CoexistenceNumber {
    return {
      wabaId: "1",
      displayPhone: null,
      verifiedName: null,
      onBizApp: null,
      platformType: null,
      event: null,
      connectedAt: "2026-10-27T10:00:00.000Z",
      lastRunAt: "2026-10-27T10:00:00.000Z",
      steps: [],
      ...over,
    };
  }

  it("keeps the first connection time when a number is re-run", () => {
    const first = entry({ phoneNumberId: "9" });
    const rerun = entry({ phoneNumberId: "9", connectedAt: "2026-10-28T09:00:00.000Z", lastRunAt: "2026-10-28T09:00:00.000Z", onBizApp: true });
    const list = upsertCoexistenceNumber([first], rerun);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ connectedAt: "2026-10-27T10:00:00.000Z", lastRunAt: "2026-10-28T09:00:00.000Z", onBizApp: true });
  });

  it("adds a different number alongside", () => {
    expect(upsertCoexistenceNumber([entry({ phoneNumberId: "9" })], entry({ phoneNumberId: "10" }))).toHaveLength(2);
  });

  it("reads the stored setting leniently", () => {
    expect(parseCoexistenceNumbers(null)).toEqual([]);
    expect(parseCoexistenceNumbers("not json")).toEqual([]);
    expect(parseCoexistenceNumbers(JSON.stringify([entry({ phoneNumberId: "9" }), { junk: true }]))).toHaveLength(1);
  });
});
