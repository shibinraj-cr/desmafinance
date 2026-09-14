import { describe, it, expect } from "vitest";
import {
  reminderFireAt,
  istHour,
  isWithinSendWindow,
  skipReasonForChannel,
  isCoolingDown,
  resolveTemplates,
  availableChannels,
  buildTaskMergeVars,
  reminderStatusLabel,
  EMPTY_CONFIG,
  DEFAULT_COOLDOWN_HOURS,
  parseTaskReminderConfig,
  isConsultantEnrolled,
  type TaskReminderConfig,
  type ReminderLeadFacts,
  type RawTaskReminderSettings,
} from "@/lib/crm-task-reminders";

const lead = (over: Partial<ReminderLeadFacts> = {}): ReminderLeadFacts => ({
  phoneE164: "+919876543210",
  email: "candidate@example.com",
  whatsappOptedOutAt: null,
  whatsappUndeliverableAt: null,
  ...over,
});

const config = (over: Partial<TaskReminderConfig> = {}): TaskReminderConfig => ({
  ...EMPTY_CONFIG,
  enabled: true,
  waTemplate: "task_follow_up:en",
  emailTemplateId: "tmpl_email_1",
  ...over,
});

describe("reminderFireAt", () => {
  it("fires at 09:00 IST on the day AFTER the due date", () => {
    // A date picker sends "2026-09-15", parsed as UTC midnight.
    const due = new Date("2026-09-15T00:00:00.000Z");
    const fire = reminderFireAt(due)!;
    // 09:00 IST on the 16th === 03:30 UTC on the 16th.
    expect(fire.toISOString()).toBe("2026-09-16T03:30:00.000Z");
  });

  it("uses the IST calendar day of the due date, not the UTC one", () => {
    // 22:00 UTC on the 15th is already 03:30 on the 16th in IST, so the due day
    // is the 16th and the reminder belongs to the 17th.
    const due = new Date("2026-09-15T22:00:00.000Z");
    expect(reminderFireAt(due)!.toISOString()).toBe("2026-09-17T03:30:00.000Z");
  });

  it("crosses a month boundary", () => {
    expect(reminderFireAt(new Date("2026-09-30T00:00:00.000Z"))!.toISOString()).toBe(
      "2026-10-01T03:30:00.000Z",
    );
  });

  it("has no fire time without a due date", () => {
    expect(reminderFireAt(null)).toBeNull();
    expect(reminderFireAt(undefined)).toBeNull();
    expect(reminderFireAt(new Date("nonsense"))).toBeNull();
  });

  it("always lands inside the send window", () => {
    for (const day of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      const fire = reminderFireAt(new Date(`${day}T00:00:00.000Z`))!;
      expect(isWithinSendWindow(fire)).toBe(true);
    }
  });
});

describe("istHour / isWithinSendWindow", () => {
  it("reads the hour in IST, not UTC", () => {
    // 03:30 UTC is 09:00 IST.
    expect(istHour(new Date("2026-09-16T03:30:00.000Z"))).toBe(9);
    // 20:00 UTC is 01:30 IST the NEXT day.
    expect(istHour(new Date("2026-09-16T20:00:00.000Z"))).toBe(1);
  });

  it("is closed before 09:00 and from 20:00 IST", () => {
    const at = (iso: string) => isWithinSendWindow(new Date(iso));
    expect(at("2026-09-16T03:29:00.000Z")).toBe(false); // 08:59 IST
    expect(at("2026-09-16T03:30:00.000Z")).toBe(true); //  09:00 IST
    expect(at("2026-09-16T14:29:00.000Z")).toBe(true); //  19:59 IST
    expect(at("2026-09-16T14:30:00.000Z")).toBe(false); // 20:00 IST
    expect(at("2026-09-16T20:00:00.000Z")).toBe(false); // 01:30 IST — the 3am case
  });
});

describe("skipReasonForChannel", () => {
  it("lets a reachable candidate through on both channels", () => {
    expect(skipReasonForChannel("whatsapp", lead())).toBeNull();
    expect(skipReasonForChannel("email", lead())).toBeNull();
  });

  it("puts opt-out ahead of every other WhatsApp reason", () => {
    const optedOutAndBroken = lead({
      whatsappOptedOutAt: new Date(),
      whatsappUndeliverableAt: new Date(),
      phoneE164: null,
    });
    expect(skipReasonForChannel("whatsapp", optedOutAndBroken)).toBe("opted_out");
  });

  it("reports an undeliverable number over a missing one", () => {
    expect(
      skipReasonForChannel("whatsapp", lead({ whatsappUndeliverableAt: new Date(), phoneE164: null })),
    ).toBe("undeliverable");
  });

  it("catches a missing phone and a missing email", () => {
    expect(skipReasonForChannel("whatsapp", lead({ phoneE164: null }))).toBe("no_phone");
    expect(skipReasonForChannel("email", lead({ email: null }))).toBe("no_email");
    expect(skipReasonForChannel("email", lead({ email: "   " }))).toBe("no_email");
  });

  it("does not let a WhatsApp opt-out silence the email channel", () => {
    // Opting out of WhatsApp marketing is not opting out of email.
    expect(skipReasonForChannel("email", lead({ whatsappOptedOutAt: new Date() }))).toBeNull();
  });
});

describe("isCoolingDown", () => {
  const now = new Date("2026-09-16T10:00:00.000Z");

  it("is not cooling down when nothing was ever sent", () => {
    expect(isCoolingDown(null, now)).toBe(false);
  });

  it("blocks a second reminder inside the window", () => {
    expect(isCoolingDown(new Date("2026-09-16T02:00:00.000Z"), now)).toBe(true);
  });

  it("allows one once the window has passed", () => {
    expect(isCoolingDown(new Date("2026-09-15T09:59:00.000Z"), now)).toBe(false);
  });

  it("treats the boundary as elapsed", () => {
    const exactly24hAgo = new Date(now.getTime() - DEFAULT_COOLDOWN_HOURS * 3_600_000);
    expect(isCoolingDown(exactly24hAgo, now)).toBe(false);
  });

  it("is disabled by a zero or negative cooldown", () => {
    expect(isCoolingDown(new Date(now.getTime() - 1000), now, 0)).toBe(false);
  });
});

describe("resolveTemplates", () => {
  it("falls back to the global defaults when nothing is overridden", () => {
    expect(resolveTemplates(config(), "Follow-up Call")).toEqual({
      waTemplate: "task_follow_up:en",
      emailTemplateId: "tmpl_email_1",
      waVariables: {},
    });
  });

  it("prefers a per-task-type override", () => {
    const c = config({
      overrides: { "Payment Request": { waTemplate: "payment_due:en", emailTemplateId: "tmpl_pay" } },
    });
    expect(resolveTemplates(c, "Payment Request")).toEqual({
      waTemplate: "payment_due:en",
      emailTemplateId: "tmpl_pay",
      waVariables: {},
    });
    // A different type is untouched by that override.
    expect(resolveTemplates(c, "Follow-up Call").waTemplate).toBe("task_follow_up:en");
  });

  it("falls through to the default on a blank override rather than sending nothing", () => {
    const c = config({ overrides: { "Document Request": { waTemplate: "  ", emailTemplateId: "" } } });
    expect(resolveTemplates(c, "Document Request")).toEqual({
      waTemplate: "task_follow_up:en",
      emailTemplateId: "tmpl_email_1",
      waVariables: {},
    });
  });

  it("does not pour the default's variable map into an override's own template", () => {
    // Slot 1 of the default template is the candidate's name; a different
    // template's slot 1 could be anything. Inheriting the map would put the name
    // wherever that template happens to have a placeholder.
    const c = config({
      waVariables: { "1": "first_name" },
      overrides: { "Payment Request": { waTemplate: "payment_due:en" } },
    });
    expect(resolveTemplates(c, "Payment Request").waVariables).toEqual({});
    // A type with no override still gets the default map.
    expect(resolveTemplates(c, "Follow-up Call").waVariables).toEqual({ "1": "first_name" });
  });

  it("keeps the default map when an override only changes the email template", () => {
    const c = config({
      waVariables: { "1": "first_name" },
      overrides: { "Document Request": { emailTemplateId: "tmpl_docs" } },
    });
    expect(resolveTemplates(c, "Document Request").waVariables).toEqual({ "1": "first_name" });
  });

  it("allows a partial override", () => {
    const c = config({ overrides: { "Document Request": { emailTemplateId: "tmpl_docs" } } });
    expect(resolveTemplates(c, "Document Request")).toEqual({
      waTemplate: "task_follow_up:en",
      emailTemplateId: "tmpl_docs",
      waVariables: {},
    });
  });
});

describe("availableChannels", () => {
  it("offers both channels for a reachable, configured lead", () => {
    const out = availableChannels(config(), "Follow-up Call", lead());
    expect(out.whatsapp).toEqual({ available: true, reason: null });
    expect(out.email).toEqual({ available: true, reason: null });
  });

  it("reports an unconfigured channel before looking at the lead", () => {
    // No template configured AND no phone — the admin's omission is the one to
    // surface, since it affects every lead rather than this one.
    const out = availableChannels(config({ waTemplate: null }), "Follow-up Call", lead({ phoneE164: null }));
    expect(out.whatsapp).toEqual({ available: false, reason: "not_configured" });
  });

  it("closes only the channel that cannot reach this candidate", () => {
    const out = availableChannels(config(), "Follow-up Call", lead({ email: null }));
    expect(out.whatsapp.available).toBe(true);
    expect(out.email).toEqual({ available: false, reason: "no_email" });
  });
});

describe("buildTaskMergeVars", () => {
  it("renders the pending item and an IST due date", () => {
    expect(buildTaskMergeVars({ subject: "Document Request", dueAt: new Date("2026-09-15T00:00:00.000Z") })).toEqual({
      task: "Document Request",
      due_date: "15 Sept 2026",
    });
  });

  it("leaves the due date empty rather than printing Invalid Date", () => {
    expect(buildTaskMergeVars({ subject: "Follow-up Call", dueAt: null }).due_date).toBe("");
  });
});

describe("reminderStatusLabel", () => {
  const base = { channel: "whatsapp", fireAt: "2026-09-16T03:30:00.000Z", sentAt: null, skipReason: null };

  it("names the channel and the scheduled day while pending", () => {
    expect(reminderStatusLabel({ ...base, status: "pending" })).toBe(
      "WhatsApp reminder scheduled for 16 Sept 2026",
    );
  });

  it("explains a skip in words", () => {
    expect(reminderStatusLabel({ ...base, status: "skipped", skipReason: "opted_out" })).toContain(
      "opted out",
    );
  });

  it("does not invent a reason when none was recorded", () => {
    expect(reminderStatusLabel({ ...base, status: "skipped" })).toContain("no reason recorded");
  });

  it("reports a completed send with its date", () => {
    expect(
      reminderStatusLabel({ ...base, status: "sent", sentAt: "2026-09-16T04:00:00.000Z" }),
    ).toBe("WhatsApp reminder sent 16 Sept 2026");
  });
});

describe("parseTaskReminderConfig", () => {
  const raw = (over: Partial<RawTaskReminderSettings> = {}): RawTaskReminderSettings => ({
    enabled: "1",
    waTemplate: "task_follow_up:en",
    waVariables: null,
    emailTemplateId: "tmpl_email_1",
    overrides: null,
    cooldownHours: null,
    defaultChannels: null,
    consultantIds: null,
    ...over,
  });

  it("reads a fully configured set of settings", () => {
    const c = parseTaskReminderConfig(
      raw({
        waVariables: '{"1":"first_name"}',
        overrides: '{"Payment Request":{"emailTemplateId":"tmpl_pay"}}',
        cooldownHours: "48",
        defaultChannels: "whatsapp",
        consultantIds: "usr_1,usr_2",
      }),
    );
    expect(c).toEqual({
      enabled: true,
      waTemplate: "task_follow_up:en",
      waVariables: { "1": "first_name" },
      emailTemplateId: "tmpl_email_1",
      overrides: { "Payment Request": { emailTemplateId: "tmpl_pay" } },
      cooldownHours: 48,
      defaultChannels: ["whatsapp"],
      consultantIds: ["usr_1", "usr_2"],
    });
  });

  it("is off unless the switch is exactly \"1\"", () => {
    for (const v of [null, "", "0", "true", "yes"]) {
      expect(parseTaskReminderConfig(raw({ enabled: v })).enabled).toBe(false);
    }
    expect(parseTaskReminderConfig(raw({ enabled: "1" })).enabled).toBe(true);
  });

  it("survives a hand-edited setting that no longer parses", () => {
    const seen: string[] = [];
    const c = parseTaskReminderConfig(
      raw({ waVariables: "{not json", overrides: "[]" }),
      (key) => seen.push(key),
    );
    // The feature stays up on its defaults rather than throwing.
    expect(c.waVariables).toEqual({});
    expect(c.overrides).toEqual({});
    expect(c.enabled).toBe(true);
    // A JSON array is well-formed but the wrong shape, so it is not reported as
    // bad JSON — it just isn't a record.
    expect(seen).toEqual(["waVariables"]);
  });

  it("falls back to the default cooldown on a bad value, but honours an explicit 0", () => {
    for (const v of [null, "", "abc", "-5"]) {
      expect(parseTaskReminderConfig(raw({ cooldownHours: v })).cooldownHours).toBe(DEFAULT_COOLDOWN_HOURS);
    }
    // 0 is a deliberate "no cooldown", not a typo.
    expect(parseTaskReminderConfig(raw({ cooldownHours: "0" })).cooldownHours).toBe(0);
  });

  it("treats an unset or unrecognised channel list as both channels", () => {
    // Not "none": the feature has its own on/off switch, and an empty list would
    // make it inert while the screen said On.
    for (const v of [null, "", "   ", "sms,carrier_pigeon"]) {
      expect(parseTaskReminderConfig(raw({ defaultChannels: v })).defaultChannels).toEqual([
        "whatsapp",
        "email",
      ]);
    }
  });

  it("keeps only the channels it recognises", () => {
    expect(parseTaskReminderConfig(raw({ defaultChannels: " email , sms " })).defaultChannels).toEqual([
      "email",
    ]);
  });

  it("treats a blank template as not configured", () => {
    const c = parseTaskReminderConfig(raw({ waTemplate: "   ", emailTemplateId: "" }));
    expect(c.waTemplate).toBeNull();
    expect(c.emailTemplateId).toBeNull();
  });
});

describe("reminderStatusLabel — in-flight", () => {
  it("says a claimed reminder is going out now", () => {
    expect(
      reminderStatusLabel({
        channel: "email",
        status: "sending",
        fireAt: "2026-09-16T03:30:00.000Z",
        sentAt: null,
        skipReason: null,
      }),
    ).toBe("Email reminder sending now");
  });
});

describe("isConsultantEnrolled", () => {
  const enrolled = (ids: string[]) => ({ ...EMPTY_CONFIG, enabled: true, consultantIds: ids });

  it("allows only the listed consultants", () => {
    const c = enrolled(["usr_a", "usr_b"]);
    expect(isConsultantEnrolled(c, "usr_a")).toBe(true);
    expect(isConsultantEnrolled(c, "usr_b")).toBe(true);
    expect(isConsultantEnrolled(c, "usr_c")).toBe(false);
  });

  // The decision that matters most: an empty list must mean NOBODY. Read the
  // other way, switching the master toggle on would start messaging every
  // consultant's candidates at once.
  it("treats an empty list as nobody, not everybody", () => {
    expect(isConsultantEnrolled(enrolled([]), "usr_a")).toBe(false);
  });

  it("never enrols an unassigned task", () => {
    const c = enrolled(["usr_a"]);
    expect(isConsultantEnrolled(c, null)).toBe(false);
    expect(isConsultantEnrolled(c, undefined)).toBe(false);
    expect(isConsultantEnrolled(c, "")).toBe(false);
  });
});

describe("availableChannels — consultant gate", () => {
  const base = {
    ...EMPTY_CONFIG,
    enabled: true,
    waTemplate: "task_follow_up:en",
    emailTemplateId: "tmpl_email_1",
    consultantIds: ["usr_a"],
  };
  const reachable: ReminderLeadFacts = {
    phoneE164: "+919876543210",
    email: "c@example.com",
    whatsappOptedOutAt: null,
    whatsappUndeliverableAt: null,
  };

  it("opens both channels for an enrolled consultant", () => {
    const out = availableChannels(base, "Follow-up Call", reachable, "usr_a");
    expect(out.whatsapp.available).toBe(true);
    expect(out.email.available).toBe(true);
  });

  it("closes both channels for a consultant who is not enrolled", () => {
    const out = availableChannels(base, "Follow-up Call", reachable, "usr_z");
    expect(out.whatsapp).toEqual({ available: false, reason: "consultant_not_enrolled" });
    expect(out.email).toEqual({ available: false, reason: "consultant_not_enrolled" });
  });

  // Enrolment is about the consultant, not the channel, so it is the useful
  // thing to report — "no email address" would send someone hunting the wrong bug.
  it("reports enrolment ahead of a lead-level problem", () => {
    const out = availableChannels(base, "Follow-up Call", { ...reachable, email: null }, "usr_z");
    expect(out.email.reason).toBe("consultant_not_enrolled");
  });

  it("skips the gate entirely when no assignee is supplied", () => {
    // Callers that genuinely have no assignee in hand (the settings preview)
    // still get the template/lead answers rather than a blanket refusal.
    const out = availableChannels(base, "Follow-up Call", reachable);
    expect(out.whatsapp.available).toBe(true);
  });
});
