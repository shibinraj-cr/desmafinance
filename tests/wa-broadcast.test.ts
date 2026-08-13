import { describe, it, expect } from "vitest";
import { renderRecipientParams, skipReasonFor } from "@/lib/wa/broadcast";
import { isOptOutMessage } from "@/lib/wa/inbound";
import {
  buildTemplateComponents,
  isRetryableGraphError,
  parseGraphError,
  toCloudRecipient,
} from "@/lib/wa/cloud-provider";
import { verifyMetaSignature } from "@/lib/wa/signature";
import { createHmac } from "node:crypto";

describe("isOptOutMessage", () => {
  it("catches the one-tap replies WhatsApp actually sends", () => {
    for (const w of ["STOP", "stop", "Stop.", "unsubscribe", "opt out", "Remove me"]) {
      expect(isOptOutMessage(w)).toBe(true);
    }
  });

  // Substring matching would read a complaint as an opt-out and silently drop a
  // live candidate out of every future campaign.
  it("does NOT treat a sentence containing 'stop' as an opt-out", () => {
    expect(isOptOutMessage("stop sending me the wrong course details")).toBe(false);
    expect(isOptOutMessage("please don't stop helping me")).toBe(false);
  });

  it("ignores empty input", () => {
    expect(isOptOutMessage(null)).toBe(false);
    expect(isOptOutMessage("   ")).toBe(false);
  });
});

describe("skipReasonFor", () => {
  const ok = { phoneE164: "+919876543210", whatsappOptedOutAt: null, whatsappUndeliverableAt: null };

  it("sends to a reachable lead", () => {
    expect(skipReasonFor(ok)).toBeNull();
  });

  // Opt-out is a promise to the candidate and outranks everything else.
  it("honours an opt-out above all", () => {
    expect(skipReasonFor({ ...ok, whatsappOptedOutAt: new Date() })).toBe("opted_out");
    expect(
      skipReasonFor({ ...ok, whatsappOptedOutAt: new Date(), whatsappUndeliverableAt: new Date() }),
    ).toBe("opted_out");
  });

  it("skips a number Meta already told us is dead", () => {
    expect(skipReasonFor({ ...ok, whatsappUndeliverableAt: new Date() })).toBe("undeliverable");
  });

  it("skips a lead with no sendable number", () => {
    expect(skipReasonFor({ ...ok, phoneE164: null })).toBe("no_phone");
  });
});

describe("renderRecipientParams", () => {
  const lead = {
    candidateName: "Test Candidate",
    campaign: "August Intake",
    service: { name: "Study Abroad" },
    qualification: { label: "Graduate" },
    assignedTo: { username: "bde1", leadPulseRole: { displayName: "Consultant One", phone: "+971500000000" } },
  };

  it("is empty when no variables are mapped", () => {
    expect(renderRecipientParams(null, lead)).toEqual({});
    expect(renderRecipientParams({}, lead)).toEqual({});
  });

  it("renders each numbered slot from the CRM's own merge tokens", () => {
    const out = renderRecipientParams({ "1": "{name}" }, lead);
    expect(out["1"]).toBe("Test Candidate");
  });
});

describe("buildTemplateComponents", () => {
  it("sends nothing when the template has no variables", () => {
    expect(buildTemplateComponents({})).toEqual([]);
  });

  it("orders positional variables NUMERICALLY, not as strings", () => {
    // A plain string sort puts "10" before "2" and silently shifts every
    // variable after the ninth into the wrong slot.
    const params: Record<string, string> = {};
    for (let i = 1; i <= 11; i++) params[String(i)] = `v${i}`;
    const [body] = buildTemplateComponents(params) as [{ parameters: { text: string }[] }];
    expect(body.parameters.map((p) => p.text)).toEqual([
      "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11",
    ]);
  });

  it("wraps values in Meta's body-component shape", () => {
    expect(buildTemplateComponents({ "1": "Priya" })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Priya" }] },
    ]);
  });

  // A template with a header variable or a URL button rejects a send that omits
  // that component, and Meta fails the WHOLE request — so body-only would break
  // every recipient of any template that is not body-only.
  it("emits header, body and button components in the order Meta expects", () => {
    const out = buildTemplateComponents({
      "button.0.1": "ref123",
      "1": "Priya",
      "header.1": "August Intake",
    }) as { type: string; sub_type?: string; index?: string; parameters: { text: string }[] }[];

    expect(out.map((c) => c.type)).toEqual(["header", "body", "button"]);
    expect(out[0].parameters[0].text).toBe("August Intake");
    expect(out[1].parameters[0].text).toBe("Priya");
    expect(out[2]).toMatchObject({ type: "button", sub_type: "url", index: "0" });
  });

  it("keeps several buttons apart by index", () => {
    const out = buildTemplateComponents({ "button.0.1": "a", "button.1.1": "b" }) as { index?: string }[];
    expect(out.map((c) => c.index)).toEqual(["0", "1"]);
  });
});

describe("isRetryableGraphError", () => {
  it("retries rate limits and upstream faults — they say nothing about the recipient", () => {
    expect(isRetryableGraphError("130429", 400)).toBe(true);
    expect(isRetryableGraphError(null, 429)).toBe(true);
    expect(isRetryableGraphError(null, 503)).toBe(true);
  });

  it("retries a request that never completed", () => {
    expect(isRetryableGraphError(null, null)).toBe(true);
  });

  // Burning a recipient on a genuine rejection is correct; burning one on a
  // blip silently drops part of the audience.
  it("does NOT retry a genuine rejection", () => {
    expect(isRetryableGraphError("131026", 400)).toBe(false); // undeliverable
    expect(isRetryableGraphError("132001", 400)).toBe(false); // template missing
    expect(isRetryableGraphError("190", 401)).toBe(false); // token expired
  });
});

describe("toCloudRecipient", () => {
  it("strips the plus Meta will not accept", () => {
    expect(toCloudRecipient("+919876543210")).toBe("919876543210");
  });
  it("strips separators too", () => {
    expect(toCloudRecipient("+91 98765-43210")).toBe("919876543210");
  });
});

describe("parseGraphError", () => {
  it("pulls out Meta's numeric code and detail", () => {
    const body = JSON.stringify({
      error: { code: 131049, message: "Generic error", error_data: { details: "marketing frequency cap" } },
    });
    expect(parseGraphError(body)).toEqual({ code: "131049", message: "marketing frequency cap" });
  });

  it("falls back to the message when there is no detail", () => {
    expect(parseGraphError(JSON.stringify({ error: { code: 190, message: "Token expired" } }))).toEqual({
      code: "190",
      message: "Token expired",
    });
  });

  it("degrades to the raw body on non-JSON", () => {
    expect(parseGraphError("upstream exploded").code).toBeNull();
  });
});

describe("verifyMetaSignature", () => {
  const secret = "app-secret";
  const body = '{"entry":[{"changes":[]}]}';
  const good = "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

  it("accepts a signature over the exact raw body", () => {
    expect(verifyMetaSignature(body, good, secret)).toBe("valid");
  });

  // The signature covers raw bytes, so verifying a re-serialised body always
  // fails — this is the mistake that breaks every request.
  it("rejects a signature checked against a re-serialised body", () => {
    const reserialised = JSON.stringify(JSON.parse(body));
    const differs = reserialised !== body;
    if (differs) expect(verifyMetaSignature(reserialised, good, secret)).toBe("invalid");
  });

  it("rejects a tampered body", () => {
    expect(verifyMetaSignature(body + " ", good, secret)).toBe("invalid");
  });

  it("rejects a wrong secret", () => {
    expect(verifyMetaSignature(body, good, "other")).toBe("invalid");
  });

  it("rejects a malformed header", () => {
    expect(verifyMetaSignature(body, "sha1=abc", secret)).toBe("invalid");
    expect(verifyMetaSignature(body, "sha256=zz", secret)).toBe("invalid");
  });

  // These two are distinct on purpose: one means "fall back to the shared
  // secret", the other means "we hold nothing to verify with".
  it("reports an unsigned request as missing, not invalid", () => {
    expect(verifyMetaSignature(body, null, secret)).toBe("missing");
    expect(verifyMetaSignature(body, "  ", secret)).toBe("missing");
  });

  it("reports an absent app secret as not_configured", () => {
    expect(verifyMetaSignature(body, good, null)).toBe("not_configured");
    expect(verifyMetaSignature(body, good, "   ")).toBe("not_configured");
  });
});
