/**
 * Candidate referral links: the pure rules (codes, names, who counts), the form
 * taking a submission (new lead / already in the CRM / own number / switched-off
 * link), both routes, and the middleware letting strangers reach only the public
 * half. Prisma is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  lead: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  crmReferralLink: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  crmReferralSubmission: { create: vi.fn(), count: vi.fn() },
  crmReferralVisitDay: { upsert: vi.fn(), aggregate: vi.fn() },
  crmLeadStatus: { findFirst: vi.fn() },
  crmLeadSubStatus: { findFirst: vi.fn() },
  leadPulseSource: { findUnique: vi.fn(), findFirst: vi.fn() },
  crmQualification: { findFirst: vi.fn(), findUnique: vi.fn() },
  service: { findFirst: vi.fn() },
  crmNotification: { createMany: vi.fn() },
}));
const reinquiry = vi.hoisted(() => ({
  resolveReInquiryContext: vi.fn(async () => ({ reMarketingStatusId: null, supervisorUserId: null, marketingAdminIds: [] })),
  recordReInquiry: vi.fn(async () => null),
  notifySupervisorOfReInquiries: vi.fn(async () => {}),
}));
const activity = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => ({ canViewLeads: true, canAssign: false }));
const limiter = vi.hoisted(() => ({ ok: true }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/crm-reinquiry", () => reinquiry);
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: activity }));
vi.mock("@/lib/crm-notify", () => ({ marketingAdminUserIds: vi.fn(async () => ["admin1", "admin2"]) }));
vi.mock("@/lib/hiring/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: limiter.ok, retryAfterSeconds: limiter.ok ? 0 : 60 })),
}));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({
    userId: "bde1",
    perms: { isAdmin: false, canApprove: false, needsApproval: false, draftFirst: false, pages: ["/crm/leads"], roleName: "Test" },
  })),
}));
vi.mock("@/lib/crm-rbac", () => ({ getCrmAccess: vi.fn(async () => access) }));

import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  classifyReferralSubmission,
  generateReferralCode,
  isPreviewOrBot,
  normalizeReferralCode,
  referralShareMessage,
  referralUrl,
  referrerFirstName,
  whatsappShareHref,
} from "@/lib/crm-referral-link";
import { submitReferral, type PublicReferralLink } from "@/lib/crm-referral";
import { POST as submitRoute } from "@/app/api/referral/[code]/route";
import { POST as visitRoute } from "@/app/api/referral/[code]/visit/route";
import { POST as getLink, PATCH as switchLink } from "@/app/api/crm/leads/[id]/referral-link/route";
import { config as middlewareConfig } from "@/middleware";

const CODE = "K7M2QXA";

function link(over: Partial<PublicReferralLink> = {}): PublicReferralLink {
  return {
    id: "link1",
    code: CODE,
    active: true,
    referrerLeadId: "asha",
    referrerLead: { candidateName: "Asha Kumar", phoneE164: "+919847000001", altPhoneE164: null, emailKey: "asha@example.com" },
    ...over,
  };
}

const form = { name: "Kiran Das", phone: "98470 12345", email: "", qualificationId: "q-bsc", serviceId: "s-nclex" };

beforeEach(() => {
  vi.clearAllMocks();
  access.canViewLeads = true;
  access.canAssign = false;
  limiter.ok = true;
  db.lead.findFirst.mockResolvedValue(null);
  db.lead.create.mockImplementation(async ({ data }: { data: { candidateName: string } }) => ({ id: "new1", candidateName: data.candidateName }));
  db.crmLeadStatus.findFirst.mockResolvedValue({ id: "st-new", code: "not_yet_started", label: "New" });
  db.crmLeadSubStatus.findFirst.mockResolvedValue({ id: "sub-default" });
  db.leadPulseSource.findUnique.mockResolvedValue({ id: "src-referral-link" });
  db.crmQualification.findFirst.mockResolvedValue({ id: "q-bsc" });
  db.crmQualification.findUnique.mockResolvedValue({ label: "BSc Nursing" });
  db.service.findFirst.mockResolvedValue({ id: "s-nclex" });
  db.crmReferralSubmission.create.mockResolvedValue({});
  db.crmNotification.createMany.mockResolvedValue({ count: 2 });
});

// ── Pure rules ──────────────────────────────────────────────────────────────

describe("codes", () => {
  it("draws 7 characters from the unambiguous alphabet", () => {
    let i = 0;
    const code = generateReferralCode((max) => i++ % max);
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    for (const ch of code) expect(REFERRAL_CODE_ALPHABET).toContain(ch);
    expect(REFERRAL_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("accepts a retyped lower-case code and rejects anything that can't be one", () => {
    expect(normalizeReferralCode(" k7m2qxa ")).toBe(CODE);
    expect(normalizeReferralCode("K7M2QX")).toBeNull(); // too short
    expect(normalizeReferralCode("K7M2QX0")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeReferralCode("../../x")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });

  it("builds the public URL without a double slash", () => {
    expect(referralUrl("https://desgro.in/", CODE)).toBe(`https://desgro.in/r/${CODE}`);
  });
});

describe("the name shown to a stranger", () => {
  it("is the first name only, tidied", () => {
    expect(referrerFirstName("Asha Kumar")).toBe("Asha");
    expect(referrerFirstName("ASHA K")).toBe("Asha");
    expect(referrerFirstName("Dr. Meera Nair")).toBe("Meera");
    expect(referrerFirstName("  Anu  ")).toBe("Anu");
  });

  it("is nothing for a placeholder a channel gave the lead", () => {
    expect(referrerFirstName("+91 98470 12345")).toBeNull();
    expect(referrerFirstName("@asha_rn")).toBeNull();
    expect(referrerFirstName("Instagram lead")).toBeNull();
    expect(referrerFirstName("")).toBeNull();
    expect(referrerFirstName("A")).toBeNull();
  });
});

describe("sharing", () => {
  it("writes the message with the link in it", () => {
    const text = referralShareMessage({ firstName: "Asha", url: `https://desgro.in/r/${CODE}` });
    expect(text).toContain("Hi Asha,");
    expect(text).toContain(`https://desgro.in/r/${CODE}`);
    expect(referralShareMessage({ firstName: null, url: "u" })).toMatch(/^Hi, /);
  });

  it("opens WhatsApp to the candidate, or the chat picker without a number", () => {
    expect(whatsappShareHref("+919847000001", "a b")).toBe("https://wa.me/919847000001?text=a%20b");
    expect(whatsappShareHref(null, "x")).toBe("https://wa.me/?text=x");
  });

  it("doesn't count link previews and scripts as visits", () => {
    expect(isPreviewOrBot("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(isPreviewOrBot("facebookexternalhit/1.1")).toBe(true);
    expect(isPreviewOrBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isPreviewOrBot("")).toBe(true);
    expect(isPreviewOrBot("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36")).toBe(false);
  });
});

describe("who sent the form", () => {
  const referrer = { phoneKeys: ["+919847000001"], emailKey: "asha@example.com" };
  const sub = (over: Partial<{ phoneE164: string; emailKey: string | null }> = {}) => ({
    phoneE164: "+919847012345",
    emailKey: null,
    ...over,
  });

  it("credits someone new through an active link", () => {
    expect(classifyReferralSubmission({ referrer, submitted: sub(), existingLeadId: null, linkActive: true })).toBe("created");
  });
  it("takes but doesn't credit someone new through a switched-off link", () => {
    expect(classifyReferralSubmission({ referrer, submitted: sub(), existingLeadId: null, linkActive: false })).toBe("inactive");
  });
  it("never credits someone already in the CRM", () => {
    expect(classifyReferralSubmission({ referrer, submitted: sub(), existingLeadId: "old", linkActive: true })).toBe("existing");
  });
  it("spots the candidate's own number or email", () => {
    expect(
      classifyReferralSubmission({ referrer, submitted: sub({ phoneE164: "+919847000001" }), existingLeadId: "asha", linkActive: true }),
    ).toBe("self");
    expect(
      classifyReferralSubmission({ referrer, submitted: sub({ emailKey: "asha@example.com" }), existingLeadId: "asha", linkActive: true }),
    ).toBe("self");
  });
});

// ── Taking a submission ─────────────────────────────────────────────────────

describe("submitReferral", () => {
  it("makes a new, unassigned lead filed under the candidate", async () => {
    const res = await submitReferral(link(), form);

    expect(res).toEqual({ outcome: "created", leadId: "new1" });
    const data = db.lead.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      candidateName: "Kiran Das",
      phoneE164: "+919847012345",
      sourceId: "src-referral-link",
      statusId: "st-new",
      subStatusId: "sub-default",
      qualificationId: "q-bsc",
      serviceId: "s-nclex",
      referredByLeadId: "asha",
      email: null,
    });
    expect(data.assignedToId).toBeUndefined();
    expect(data.createdById).toBeUndefined();
    expect(db.crmReferralSubmission.create).toHaveBeenCalledWith({ data: { linkId: "link1", leadId: "new1", outcome: "created" } });
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ leadId: "new1", type: "LEAD_CREATED", summary: "Created from Asha Kumar's referral link" }));
    // The Marketing Admins hear about it, to assign it.
    const bells = db.crmNotification.createMany.mock.calls[0][0].data;
    expect(bells.map((b: { userId: string }) => b.userId)).toEqual(["admin1", "admin2"]);
    expect(bells[0]).toMatchObject({ kind: "referral_lead", linkUrl: "/crm/leads/new1" });
    expect(reinquiry.recordReInquiry).not.toHaveBeenCalled();
  });

  it("keeps a lead from a switched-off link but credits nobody", async () => {
    const res = await submitReferral(link({ active: false }), form);
    expect(res.outcome).toBe("inactive");
    expect(db.lead.create.mock.calls[0][0].data.referredByLeadId).toBeNull();
    expect(db.crmReferralSubmission.create).toHaveBeenCalledWith({ data: { linkId: "link1", leadId: "new1", outcome: "inactive" } });
  });

  it("folds someone already in the CRM onto their lead as a re-inquiry, uncredited", async () => {
    db.lead.findFirst.mockResolvedValue({ id: "old1" });
    const res = await submitReferral(link(), form);

    expect(res).toEqual({ outcome: "existing", leadId: "old1" });
    expect(db.lead.create).not.toHaveBeenCalled();
    expect(reinquiry.recordReInquiry).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "old1", source: "Referral link of Asha Kumar" }),
      expect.anything(),
    );
    expect(db.crmReferralSubmission.create).toHaveBeenCalledWith({ data: { linkId: "link1", leadId: "old1", outcome: "existing" } });
  });

  it("matches an existing lead on email as well as either phone field", async () => {
    await submitReferral(link(), { ...form, email: "Kiran@Example.com" });
    const where = db.lead.findFirst.mock.calls[0][0].where.OR;
    expect(where).toEqual([{ phoneE164: "+919847012345" }, { altPhoneE164: "+919847012345" }, { emailKey: "kiran@example.com" }]);
  });

  it("does nothing but log the candidate trying their own link", async () => {
    db.lead.findFirst.mockResolvedValue({ id: "asha" });
    const res = await submitReferral(link(), { ...form, phone: "+91 98470 00001" });

    expect(res).toEqual({ outcome: "self", leadId: "asha" });
    expect(db.lead.create).not.toHaveBeenCalled();
    expect(reinquiry.recordReInquiry).not.toHaveBeenCalled();
    expect(db.crmReferralSubmission.create).toHaveBeenCalledWith({ data: { linkId: "link1", leadId: "asha", outcome: "self" } });
  });

  it("drops a qualification or service that isn't active rather than trusting the form", async () => {
    db.crmQualification.findFirst.mockResolvedValue(null);
    db.service.findFirst.mockResolvedValue(null);
    await submitReferral(link(), { ...form, qualificationId: "forged", serviceId: "forged" });
    expect(db.lead.create.mock.calls[0][0].data).toMatchObject({ qualificationId: null, serviceId: null });
  });

  it("refuses a number it can't read", async () => {
    await expect(submitReferral(link(), { ...form, phone: "12345" })).rejects.toMatchObject({ status: 400, code: "invalid_phone" });
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://local/api/referral/${CODE}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const goodBody = { ...form, consent: true, dwellMs: 20_000 };

describe("POST /api/referral/[code]", () => {
  beforeEach(() => {
    db.crmReferralLink.findUnique.mockResolvedValue(link());
  });

  it("takes the form and answers only ok", async () => {
    const res = await submitRoute(post(goodBody), { params: { code: CODE.toLowerCase() } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.crmReferralLink.findUnique.mock.calls[0][0].where).toEqual({ code: CODE });
    expect(db.lead.create).toHaveBeenCalledOnce();
  });

  it("answers someone already in the CRM exactly the same way", async () => {
    db.lead.findFirst.mockResolvedValue({ id: "old1" });
    const res = await submitRoute(post(goodBody), { params: { code: CODE } });
    expect(await res.json()).toEqual({ ok: true });
  });

  it("lets the honeypot and the too-fast submit through without touching the database", async () => {
    for (const body of [{ ...goodBody, website: "x" }, { ...goodBody, dwellMs: 500 }]) {
      const res = await submitRoute(post(body), { params: { code: CODE } });
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(db.crmReferralLink.findUnique).not.toHaveBeenCalled();
    expect(db.lead.create).not.toHaveBeenCalled();
  });

  it("needs consent", async () => {
    const res = await submitRoute(post({ ...goodBody, consent: false }), { params: { code: CODE } });
    expect(res.status).toBe(400);
    expect(db.lead.create).not.toHaveBeenCalled();
  });

  it("404s a code that isn't a link", async () => {
    db.crmReferralLink.findUnique.mockResolvedValue(null);
    const res = await submitRoute(post(goodBody), { params: { code: CODE } });
    expect(res.status).toBe(404);
  });

  it("slows down one connection sending many forms", async () => {
    limiter.ok = false;
    const res = await submitRoute(post(goodBody), { params: { code: CODE } });
    expect(res.status).toBe(429);
    expect(db.lead.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/referral/[code]/visit", () => {
  const visit = (ua: string) =>
    visitRoute(new Request(`http://local/api/referral/${CODE}/visit`, { method: "POST", headers: { "user-agent": ua } }), {
      params: { code: CODE },
    });

  it("counts a person on today's IST row", async () => {
    db.crmReferralLink.findUnique.mockResolvedValue(link());
    const res = await visit("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1");
    expect(res.status).toBe(204);
    expect(db.crmReferralVisitDay.upsert).toHaveBeenCalledOnce();
    const arg = db.crmReferralVisitDay.upsert.mock.calls[0][0];
    expect(arg.update).toEqual({ visits: { increment: 1 } });
    expect(arg.create.linkId).toBe("link1");
  });

  it("ignores a link preview", async () => {
    const res = await visit("WhatsApp/2.24.1 i");
    expect(res.status).toBe(204);
    expect(db.crmReferralVisitDay.upsert).not.toHaveBeenCalled();
  });
});

describe("POST/PATCH /api/crm/leads/[id]/referral-link", () => {
  const req = (method: string, body?: unknown) =>
    new Request("http://local/api/crm/leads/asha/referral-link", {
      method,
      headers: { "content-type": "application/json", host: "desgro.test" },
      body: body ? JSON.stringify(body) : undefined,
    });

  it("gives anyone who can see leads the link, made on first ask", async () => {
    db.lead.findUnique.mockResolvedValue({ id: "asha" });
    db.crmReferralLink.findUnique.mockResolvedValue(null);
    db.crmReferralLink.create.mockImplementation(async ({ data }: { data: { code: string } }) => ({ ...data, active: true }));

    const res = await getLink(req("POST"), { params: { id: "asha" } });
    expect(res.status).toBe(200);
    const { link: made } = await res.json();
    expect(made.url).toMatch(/\/r\/[23456789A-HJKMNP-Z]{7}$/);
    expect(db.crmReferralLink.create.mock.calls[0][0].data).toMatchObject({ referrerLeadId: "asha", createdById: "bde1" });
  });

  it("returns the existing link rather than making a second", async () => {
    db.lead.findUnique.mockResolvedValue({ id: "asha" });
    db.crmReferralLink.findUnique.mockResolvedValue({ id: "link1", code: CODE, active: true });
    const res = await getLink(req("POST"), { params: { id: "asha" } });
    expect((await res.json()).link.url).toMatch(new RegExp(`/r/${CODE}$`));
    expect(db.crmReferralLink.create).not.toHaveBeenCalled();
  });

  it("is closed to someone without CRM access", async () => {
    access.canViewLeads = false;
    const res = await getLink(req("POST"), { params: { id: "asha" } });
    expect(res.status).toBe(403);
  });

  it("lets only whoever assigns leads switch a link off", async () => {
    db.crmReferralLink.findUnique.mockResolvedValue({ id: "link1" });
    db.crmReferralLink.update.mockResolvedValue({ code: CODE, active: false });

    expect((await switchLink(req("PATCH", { active: false }), { params: { id: "asha" } })).status).toBe(403);
    access.canAssign = true;
    const res = await switchLink(req("PATCH", { active: false }), { params: { id: "asha" } });
    expect(res.status).toBe(200);
    expect(db.crmReferralLink.update).toHaveBeenCalledWith({ where: { id: "link1" }, data: { active: false } });
  });
});

describe("middleware", () => {
  const gated = (path: string) => new RegExp(`^${middlewareConfig.matcher[0]}$`).test(path);
  it("lets a stranger reach the referral page and its two endpoints, and nothing else", () => {
    expect(gated(`/r/${CODE}`)).toBe(false);
    expect(gated(`/api/referral/${CODE}`)).toBe(false);
    expect(gated(`/api/referral/${CODE}/visit`)).toBe(false);
    expect(gated("/api/crm/leads/asha/referral-link")).toBe(true);
    expect(gated("/crm/referral-leads")).toBe(true);
    expect(gated("/roles")).toBe(true);
    expect(gated("/reports")).toBe(true);
  });
});
