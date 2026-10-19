import { prisma } from "./prisma";
import { conflict, badRequest, notFound } from "./http-error";
import { normalizePhone, emailKeyOf, computeDedupeKey, isOtherQualification, qualificationText } from "./crm";
import { parseDobInput } from "./age";
import { recordLeadActivity } from "./crm-activity";
import { recordOpsActivity } from "./ops-activity";
import { recordAudit } from "./audit";

/**
 * Candidate-detail edits made from an Operations project.
 *
 * Once a candidate is enrolled their identity lives in two places: the Finance
 * `Party` (what the Operations workspace and every ledger row read) and the CRM
 * `Lead`(s) linked to it (a re-enrolled candidate has one lead per service).
 * The documentation team is usually the first to see the passport, so they are
 * the ones who find the misspelt name or the wrong DOB — and a fix made in only
 * one place leaves the other quietly wrong. So an edit here is written to the
 * Party AND to every CRM lead of that candidate in one transaction, plus the
 * name/phone copies on their Marketing pipeline rows.
 *
 * Only the fields the user actually changed are sent and written. Another lead
 * of the same candidate may hold a different DOB; correcting the name must not
 * silently overwrite it with this lead's.
 *
 * History: one CANDIDATE_UPDATED entry on the project (with every from → to),
 * one FIELD_UPDATED entry on each CRM lead that changed, and a Party audit row
 * when the name/email/phone changed (Finance reads the audit log).
 */

export type CandidateField =
  | "candidateName"
  | "email"
  | "phone"
  | "altPhone"
  | "dob"
  | "country"
  | "qualificationId"
  | "qualificationOther";

/** What the caller wants changed. `undefined` = leave alone; `null` = clear. */
export type CandidatePatch = Partial<Record<CandidateField, string | null>>;

/** One readable change for the History tabs. Qualification is folded to text. */
export type CandidateChange = { field: string; label: string; from: string | null; to: string | null };

export const CANDIDATE_FIELD_LABELS: Record<string, string> = {
  candidateName: "Name",
  email: "Email",
  phone: "Phone",
  altPhone: "Alternative phone",
  dob: "Date of birth",
  country: "Country",
  qualification: "Qualification",
};

/** Trim every provided value and turn "" into null. Name stays a string. */
export function normalizeCandidatePatch(patch: CandidatePatch): CandidatePatch {
  const out: CandidatePatch = {};
  for (const [k, v] of Object.entries(patch) as [CandidateField, string | null | undefined][]) {
    if (v === undefined) continue;
    const t = v === null ? null : v.trim();
    out[k] = t === "" ? null : t;
  }
  if (out.dob) parseDobInput(out.dob); // throws on a malformed date
  return out;
}

type LeadIdentity = {
  id: string;
  candidateName: string;
  email: string | null;
  phone: string | null;
  altPhone: string | null;
  dob: Date | null;
  country: string | null;
  qualificationId: string | null;
  qualificationOther: string | null;
  pipelineId: string | null;
};

const dobStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * The lead update + timeline diff for one lead. Pure: `qualLabels` maps every
 * qualification id involved to its label, so the "Others" rule (the free-text
 * detail survives only while the qualification IS Others) is applied without a
 * query per lead.
 */
export function planLeadUpdate(
  lead: LeadIdentity,
  patch: CandidatePatch,
  qualLabels: Map<string, string>,
): { data: Record<string, unknown>; diff: Record<string, { from: string | null; to: string | null }> } {
  const data: Record<string, unknown> = {};
  const diff: Record<string, { from: string | null; to: string | null }> = {};

  const simple: ["candidateName" | "email" | "phone" | "altPhone" | "country", string | null][] = [
    ["candidateName", lead.candidateName],
    ["email", lead.email],
    ["phone", lead.phone],
    ["altPhone", lead.altPhone],
    ["country", lead.country],
  ];
  for (const [field, current] of simple) {
    const next = patch[field];
    if (next === undefined || next === current) continue;
    if (field === "candidateName" && !next) continue; // a lead always has a name
    data[field] = next;
    diff[field] = { from: current, to: next };
  }

  if (patch.dob !== undefined && patch.dob !== dobStr(lead.dob)) {
    data.dob = parseDobInput(patch.dob) ?? null;
    diff.dob = { from: dobStr(lead.dob), to: patch.dob };
  }

  if (patch.qualificationId !== undefined || patch.qualificationOther !== undefined) {
    const nextQualId = patch.qualificationId !== undefined ? patch.qualificationId : lead.qualificationId;
    const rawOther = patch.qualificationOther !== undefined ? patch.qualificationOther : lead.qualificationOther;
    const nextOther =
      nextQualId && rawOther && isOtherQualification(qualLabels.get(nextQualId)) ? rawOther : null;
    if (nextQualId !== lead.qualificationId) data.qualificationId = nextQualId;
    if (nextOther !== lead.qualificationOther) data.qualificationOther = nextOther;
    if ("qualificationId" in data || "qualificationOther" in data) {
      diff.qualification = {
        from: qualificationText(lead.qualificationId ? qualLabels.get(lead.qualificationId) : null, lead.qualificationOther),
        to: qualificationText(nextQualId ? qualLabels.get(nextQualId) : null, nextOther),
      };
    }
  }

  // Same derived keys the CRM edit path maintains (dedupe + wa.me links).
  if ("email" in data || "phone" in data) {
    const email = "email" in data ? (data.email as string | null) : lead.email;
    const phone = "phone" in data ? (data.phone as string | null) : lead.phone;
    const e164 = normalizePhone(phone);
    data.phoneE164 = e164;
    data.emailKey = emailKeyOf(email);
    data.dedupeKey = computeDedupeKey(email, e164);
  }
  if ("altPhone" in data) data.altPhoneE164 = normalizePhone(data.altPhone as string | null);

  return { data, diff };
}

export type CandidateUpdateResult = {
  changes: CandidateChange[];
  partyUpdated: boolean;
  leadsUpdated: number;
};

export async function updateCandidateFromOps(args: {
  projectId: string;
  actorId: string;
  patch: CandidatePatch;
}): Promise<CandidateUpdateResult> {
  const patch = normalizeCandidatePatch(args.patch);
  if (patch.candidateName === null) throw badRequest("Name can't be empty.", "name_required");

  const project = await prisma.opsProject.findUnique({
    where: { id: args.projectId },
    select: {
      id: true,
      leadId: true,
      party: { select: { id: true, name: true, group: true, email: true, phone: true } },
    },
  });
  if (!project) throw notFound();
  const party = project.party;

  // Party names are unique per group, and two different candidates can share a
  // name — so a rename onto another candidate's name is refused, never merged.
  if (patch.candidateName && patch.candidateName !== party.name) {
    const clash = await prisma.party.findUnique({
      where: { name_group: { name: patch.candidateName, group: party.group } },
      select: { id: true },
    });
    if (clash && clash.id !== party.id) {
      throw conflict(
        `Another candidate is already named "${patch.candidateName}". If this is a different person, add an initial or surname to tell them apart.`,
        "name_taken",
      );
    }
  }

  if (patch.qualificationId) {
    const q = await prisma.crmQualification.findUnique({ where: { id: patch.qualificationId }, select: { id: true } });
    if (!q) throw badRequest("Unknown qualification.", "invalid_qualification");
  }

  // Every CRM lead of this candidate: the project's own lead plus any other
  // lead linked to the same Party (a re-enrollment for another service).
  const leads: LeadIdentity[] = await prisma.lead.findMany({
    where: { OR: [{ partyId: party.id }, ...(project.leadId ? [{ id: project.leadId }] : [])] },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      candidateName: true,
      email: true,
      phone: true,
      altPhone: true,
      dob: true,
      country: true,
      qualificationId: true,
      qualificationOther: true,
      pipelineId: true,
    },
  });

  const qualIds = new Set<string>();
  if (patch.qualificationId) qualIds.add(patch.qualificationId);
  for (const l of leads) if (l.qualificationId) qualIds.add(l.qualificationId);
  const qualLabels = new Map(
    qualIds.size
      ? (
          await prisma.crmQualification.findMany({ where: { id: { in: [...qualIds] } }, select: { id: true, label: true } })
        ).map((q) => [q.id, q.label] as const)
      : [],
  );

  // Party carries only name / email / phone.
  const partyData: Record<string, string | null> = {};
  const partyDiff: Record<string, { from: string | null; to: string | null }> = {};
  for (const [field, key] of [["candidateName", "name"], ["email", "email"], ["phone", "phone"]] as const) {
    const next = patch[field];
    if (next === undefined || next === party[key]) continue;
    partyData[key] = next;
    partyDiff[field] = { from: party[key], to: next };
  }

  const leadPlans = leads
    .map((lead) => ({ lead, ...planLeadUpdate(lead, patch, qualLabels) }))
    .filter((p) => Object.keys(p.diff).length > 0);

  // The readable change list for the project History: Party values for the
  // identity fields it holds, the project's own lead for the rest — i.e. what
  // the ops user was looking at when they pressed Save.
  const primary = leads.find((l) => l.id === project.leadId) ?? leads[0] ?? null;
  const primaryDiff = primary ? planLeadUpdate(primary, patch, qualLabels).diff : {};
  const merged = { ...primaryDiff, ...partyDiff };
  // A field already right on the project's lead but stale on another lead of
  // the candidate still changed somewhere — list it with that lead's old value.
  for (const p of leadPlans) {
    for (const [field, d] of Object.entries(p.diff)) if (!(field in merged)) merged[field] = d;
  }
  const changes: CandidateChange[] = Object.entries(merged).map(([field, d]) => ({
    field,
    label: CANDIDATE_FIELD_LABELS[field] ?? field,
    from: d.from,
    to: d.to,
  }));

  if (changes.length === 0) return { changes: [], partyUpdated: false, leadsUpdated: 0 };

  // The Marketing pipeline rows keep their own copy of name + phone for the
  // forecast lists; keep them in step with the candidate.
  const pipelineIds = leads.map((l) => l.pipelineId).filter((id): id is string => !!id);
  const pipelineData: Record<string, string | null> = {};
  if (patch.candidateName) pipelineData.candidateName = patch.candidateName;
  if (patch.phone !== undefined) pipelineData.candidatePhone = patch.phone;

  await prisma.$transaction(async (tx) => {
    if (Object.keys(partyData).length > 0) {
      await tx.party.update({ where: { id: party.id }, data: partyData });
    }
    for (const p of leadPlans) {
      await tx.lead.update({ where: { id: p.lead.id }, data: p.data });
    }
    if (Object.keys(pipelineData).length > 0) {
      await tx.leadPulsePipeline.updateMany({
        where: { OR: [{ partyId: party.id }, ...(pipelineIds.length ? [{ id: { in: pipelineIds } }] : [])] },
        data: pipelineData,
      });
    }
  });

  // History — after commit and best-effort, like every other activity write.
  const fieldList = changes.map((c) => c.label).join(", ");
  await recordOpsActivity({
    projectId: project.id,
    actorId: args.actorId,
    type: "CANDIDATE_UPDATED",
    summary: `Candidate details updated: ${fieldList}`,
    metadata: { changes, partyId: party.id, leadIds: leadPlans.map((p) => p.lead.id) },
  });
  for (const p of leadPlans) {
    const fields = Object.keys(p.diff)
      .map((k) => CANDIDATE_FIELD_LABELS[k] ?? k)
      .join(", ");
    await recordLeadActivity({
      leadId: p.lead.id,
      actorId: args.actorId,
      type: "FIELD_UPDATED",
      summary: `Updated ${fields} (from Operations)`,
      metadata: { ...p.diff, via: "operations", opsProjectId: project.id },
      // A documentation correction is not the consultant working the lead, so
      // it must not reset the lead's "last worked" clock.
      bumpLastActivity: false,
    });
  }
  if (Object.keys(partyDiff).length > 0) {
    await recordAudit({
      entityType: "Party",
      entityId: party.id,
      action: "UPDATE",
      userId: args.actorId,
      changes: { ...partyDiff, via: "operations", opsProjectId: project.id },
    });
  }

  return { changes, partyUpdated: Object.keys(partyData).length > 0, leadsUpdated: leadPlans.length };
}
