import { describe, expect, it } from "vitest";
import {
  SendInputSchema,
  activeSigners,
  agreementWaParams,
  expiryFrom,
  maskEmail,
  maskPhone,
  mergeKeysOf,
  requestReference,
  rolesOf,
  sendProblems,
} from "@/lib/esign/requests";
import { DEFAULT_EMAIL_BODY, inviteEmail } from "@/lib/esign/notify";

type F = { key: string; label: string | null; role: "Client" | "DESMA"; mergeKey: string | null };
const fields: F[] = [
  { key: "client_full_name_1", label: "Client full name", role: "Client", mergeKey: "client.full_name" },
  { key: "deal_fee_amount_1", label: "Fee", role: "Client", mergeKey: "deal.fee_amount" },
  { key: "signature_1", label: null, role: "Client", mergeKey: null },
];
const client = { role: "Client" as const, name: "Test Client", email: "client@example.com", phone: null, signOrder: 1 };

describe("what a template needs", () => {
  it("lists merge keys once, in field order, and the roles that sign", () => {
    expect(mergeKeysOf([...fields, { mergeKey: "client.full_name" }])).toEqual(["client.full_name", "deal.fee_amount"]);
    expect([...rolesOf(fields)]).toEqual(["Client"]);
    // A DESMA box that is only CRM-filled does not make DESMA a signer.
    expect([...rolesOf([...fields, { key: "d", label: null, role: "DESMA", mergeKey: "staff.name" }])]).toEqual(["Client"]);
  });
});

describe("sendProblems", () => {
  const values = { "client.full_name": "Test Client", "deal.fee_amount": "₹1,00,000" };

  it("passes a complete send and never blocks a draft", () => {
    expect(sendProblems({ input: { signers: [client], mergeData: values, action: "send" }, fields })).toEqual([]);
    expect(sendProblems({ input: { signers: [], mergeData: {}, action: "draft" }, fields })).toEqual([]);
  });

  it("names missing values and unreachable signers", () => {
    const p = sendProblems({
      input: { signers: [{ ...client, email: null }], mergeData: { "client.full_name": " " }, action: "send" },
      fields,
    });
    expect(p.join(" ")).toMatch(/Fill in: client.full_name, deal.fee_amount/);
    expect(p.join(" ")).toMatch(/Test Client needs an email address or a WhatsApp number/);
  });

  it("names a nameless signer by role", () => {
    const p = sendProblems({
      input: { signers: [{ ...client, name: " ", email: null }], mergeData: values, action: "send" },
      fields,
    });
    expect(p).toEqual(["The Client signer needs a name.", "The Client signer needs an email address or a WhatsApp number to receive the link."]);
  });

  it("requires a DESMA signer exactly when the template has DESMA boxes", () => {
    const withDesma: F[] = [...fields, { key: "desma_sig", label: null, role: "DESMA", mergeKey: null }];
    expect(sendProblems({ input: { signers: [client], mergeData: values, action: "send" }, fields: withDesma }).join(" ")).toMatch(/add a DESMA signer/);
    const desma = { role: "DESMA" as const, name: "Staff", email: "staff@example.com", phone: null, signOrder: 2 };
    expect(sendProblems({ input: { signers: [client, desma], mergeData: values, action: "send" }, fields }).join(" ")).toMatch(/nothing for DESMA/);
    expect(sendProblems({ input: { signers: [client, client], mergeData: values, action: "send" }, fields }).join(" ")).toMatch(/one signer/);
  });
});

describe("signing order", () => {
  it("gives the link to everyone pending at the lowest order", () => {
    const s = [
      { id: "a", signOrder: 2, status: "waiting" },
      { id: "b", signOrder: 1, status: "signed" },
      { id: "c", signOrder: 2, status: "waiting" },
      { id: "d", signOrder: 3, status: "waiting" },
    ];
    expect(activeSigners(s).map((x) => x.id)).toEqual(["a", "c"]);
    expect(activeSigners([{ id: "x", signOrder: 1, status: "signed" }])).toEqual([]);
  });
});

describe("expiry", () => {
  it("runs to the end of the IST day", () => {
    // 15 Oct 2026, 11:00 IST + 14 days → 29 Oct 23:59:59.999 IST = 18:29:59.999 UTC.
    expect(expiryFrom(new Date("2026-10-15T05:30:00Z"), 14).toISOString()).toBe("2026-10-29T18:29:59.999Z");
    // 18:00 UTC is still 15 Oct in India (23:30); 19:00 UTC is already 16 Oct (00:30).
    expect(expiryFrom(new Date("2026-10-15T18:00:00Z"), 1).toISOString()).toBe("2026-10-16T18:29:59.999Z");
    expect(expiryFrom(new Date("2026-10-15T19:00:00Z"), 1).toISOString()).toBe("2026-10-17T18:29:59.999Z");
  });
});

describe("masking for the audit trail", () => {
  it("keeps enough to recognise, not enough to use", () => {
    expect(maskEmail("candidate@example.com")).toBe("c*******e@example.com");
    expect(maskEmail("ab@x.in")).toBe("a*@x.in");
    expect(maskPhone("+91 98765 43210")).toBe("•••• 3210");
    expect(maskEmail(null)).toBeNull();
  });
});

describe("payload", () => {
  it("normalises contacts and refuses bad ones", () => {
    const ok = SendInputSchema.parse({
      leadId: "l1",
      templateVersionId: "v1",
      mergeData: {},
      signers: [{ role: "Client", name: " A ", email: " A@Example.COM ", phone: "", signOrder: 1 }],
      expiresInDays: 14,
      reminderDays: 3,
      action: "send",
    });
    expect(ok.signers[0]).toMatchObject({ name: "A", email: "a@example.com", phone: null });
    expect(() =>
      SendInputSchema.parse({ ...ok, signers: [{ role: "Client", name: "A", email: "not-an-email", phone: null, signOrder: 1 }] }),
    ).toThrow(/email address does not look right/);
    expect(() => SendInputSchema.parse({ ...ok, signers: [{ ...ok.signers[0], phone: "123" }] })).toThrow(/phone number/);
    expect(() => SendInputSchema.parse({ ...ok, expiresInDays: 91 })).toThrow();
  });

  it("references read as template – client", () => {
    expect(requestReference("AHPRA Agreement", "Test Client")).toBe("AHPRA Agreement – Test Client");
  });
});

describe("WhatsApp template parameters", () => {
  const v = { clientName: "Test Client", agreementName: "AHPRA Agreement", link: "https://desgro.in/sign/TOKEN", token: "TOKEN", expires: "29 October 2026" };

  it("fills body slots by convention", () => {
    expect(agreementWaParams({ body: "Hi {{1}}, your {{2}} is ready: {{3}} (until {{4}})", headerText: null, buttons: [] }, v)).toEqual({
      "1": "Test Client",
      "2": "AHPRA Agreement",
      "3": "https://desgro.in/sign/TOKEN",
      "4": "29 October 2026",
    });
    expect(agreementWaParams({ body: "Hi {{1}}", headerText: null, buttons: [] }, v)).toEqual({ "1": "Test Client" });
  });

  it("puts the token in a URL button that ends in {{1}}", () => {
    const params = agreementWaParams(
      {
        body: "Hi {{1}}, please sign your {{2}}.",
        headerText: "{{1}}",
        buttons: [
          { type: "QUICK_REPLY" },
          { type: "URL", url: "https://desgro.in/sign/{{1}}" },
        ],
      },
      v,
    );
    expect(params).toEqual({ "1": "Test Client", "2": "AHPRA Agreement", "header.1": "AHPRA Agreement", "button.1.1": "TOKEN" });
  });

  it("refuses templates it cannot fill rather than sending a broken message", () => {
    expect(agreementWaParams({ body: "{{5}}", headerText: null, buttons: [] }, v)).toBeNull();
    expect(agreementWaParams({ body: "x", headerText: "{{2}}", buttons: [] }, v)).toBeNull();
    expect(agreementWaParams({ body: "x", headerText: null, buttons: [{ type: "URL", url: "https://x/{{1}}/more" }] }, v)).toBeNull();
  });
});

describe("invite email", () => {
  const base = {
    template: { name: "AHPRA Agreement", emailSubject: null, emailBody: null, whatsappTemplateName: null },
    request: { id: "r1", reference: "AHPRA Agreement – Test Client", expiresAt: new Date("2026-10-29T18:29:59Z"), message: null, leadId: null },
    signer: { id: "s1", role: "Client", name: "Test Client", email: "c@example.com", phone: null },
    link: "https://desgro.in/sign/TOKEN",
  };

  it("uses DESMA's default wording with the link and IST expiry", () => {
    const { subject, text } = inviteEmail(base);
    expect(subject).toBe("Your AHPRA Agreement from DESMA is ready to sign");
    expect(text).toContain("Dear Test Client,");
    expect(text).toContain("https://desgro.in/sign/TOKEN");
    expect(text).toContain("works until 29 October 2026");
    expect(DEFAULT_EMAIL_BODY).toContain("{link}");
  });

  it("adds the link to custom wording that forgot it, and puts the staff note first", () => {
    const { text } = inviteEmail({
      ...base,
      template: { ...base.template, emailBody: "Hello {first_name}, please sign." },
      request: { ...base.request, message: "As discussed on the call." },
    });
    expect(text.startsWith("As discussed on the call.")).toBe(true);
    expect(text).toContain("Hello Test, please sign.");
    expect(text).toContain("https://desgro.in/sign/TOKEN");
  });
});
