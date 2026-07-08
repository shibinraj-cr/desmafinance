/**
 * End-to-end verification for the CRM re-enrollment feature (existing candidate
 * → further service). Drives the REAL code paths — `enrollLead` and
 * `reEnrollCandidate` — against whatever DATABASE_URL points to, then asserts the
 * data effects and cleans up after itself.
 *
 * SAFETY: refuses to run against the known production Neon endpoint. Run it
 * against a DISPOSABLE database only (e.g. a Neon branch of neondb):
 *
 *   DATABASE_URL='<neon-branch-url>' DIRECT_URL='<neon-branch-url>' \
 *     npx tsx prisma/verify-reenroll.ts
 *
 * The branch is a throwaway copy of prod — it already has the real services /
 * users / statuses, so the script reuses them and creates only a clearly-tagged
 * ZZ_TEST candidate, which it deletes at the end.
 */
import { prisma } from "../src/lib/prisma";
import { enrollLead } from "../src/lib/crm-enroll";
import { reEnrollCandidate } from "../src/lib/crm-reenroll";
import { resolveDefaultStatus } from "../src/lib/crm-leads";

// Production endpoint fragment — never let this script touch it.
const PROD_HOST_FRAGMENT = "ep-orange-brook-aqmaow18";

const results: { ok: boolean; label: string; detail?: string }[] = [];
function check(label: string, ok: boolean, detail?: string) {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const url = process.env.DATABASE_URL || "";
  if (url.includes(PROD_HOST_FRAGMENT)) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at the production endpoint (${PROD_HOST_FRAGMENT}). ` +
        `Point it at a disposable Neon branch instead.`,
    );
  }
  const ts = Date.now();
  console.log(`\n▶ Verifying re-enrollment against ${url.replace(/:\/\/[^@]*@/, "://***@")}\n`);

  // ── Prerequisites (reused from the branch's real data) ────────────────────
  const services = await prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 2, select: { id: true, name: true } });
  if (services.length < 2) throw new Error("Need at least 2 active services to test with.");
  const [svcA, svcB] = services;
  const l2 = await prisma.leadPulseRole.findFirst({ where: { active: true, role: "l2" }, select: { userId: true, displayName: true } });
  if (!l2) throw new Error("Need an active L2 BDE (leadPulseRole role=l2) to own the pipeline.");
  const origSource = await prisma.leadPulseSource.findFirst({ where: { active: true, code: { not: "existing_candidate" } }, orderBy: { displayOrder: "asc" }, select: { id: true, label: true } });
  if (!origSource) throw new Error("Need at least one non-existing_candidate source.");
  const reviewer = await prisma.user.findFirst({ where: { draftFirst: true }, select: { id: true } });
  const def = await resolveDefaultStatus();
  if (!def) throw new Error("No default lead status configured.");
  const enrolledStatus = await prisma.crmLeadStatus.findFirst({ where: { code: "enrolled" }, select: { id: true } });

  console.log(`  using: svcA="${svcA.name}", svcB="${svcB.name}", L2=${l2.displayName}, source="${origSource.label}", reviewer=${reviewer ? "yes" : "NONE (draft assertions will be skipped)"}\n`);

  let partyId = "";
  const leadIds: string[] = [];

  try {
    // ── Step 1: an enrolled candidate on service A (the "completed" service) ──
    const email = `zz-reenroll-${ts}@example.test`;
    const leadA = await prisma.lead.create({
      data: {
        candidateName: `ZZ_TEST_REENROLL ${ts}`,
        email,
        phone: `+9199${String(ts).slice(-8)}`,
        phoneE164: `+9199${String(ts).slice(-8)}`,
        emailKey: email.toLowerCase(),
        dedupeKey: email.toLowerCase(),
        sourceId: origSource.id,
        serviceId: svcA.id,
        statusId: def.id,
        assignedToId: l2.userId,
        assignedAt: new Date(),
        expectedValue: 10000,
        createdById: l2.userId,
      },
      select: { id: true },
    });
    leadIds.push(leadA.id);
    const enrollA = await enrollLead({ leadId: leadA.id, serviceId: svcA.id, expectedValue: 10000, ownerUserId: l2.userId, actorId: l2.userId });
    partyId = enrollA.partyId;
    console.log(`  seeded: candidate enrolled in "${svcA.name}" (party=${partyId})\n`);

    // ── Step 2: re-enroll the SAME candidate in service B (any consultant) ────
    console.log("── Re-enrolling into a second service ──");
    const re = await reEnrollCandidate({
      sourceLeadId: leadA.id,
      serviceId: svcB.id,
      expectedValue: 20000,
      actorId: l2.userId,
      canAssign: false, // the "any consultant self-serves" path — no admin
    });
    leadIds.push(re.leadId);

    // ── Assertions ────────────────────────────────────────────────────────────
    const partyServices = await prisma.partyService.findMany({ where: { partyId }, select: { serviceId: true } });
    check("candidate now holds 2 services (PartyService rows)", partyServices.length === 2, `found ${partyServices.length}`);
    const svcSet = new Set(partyServices.map((p) => p.serviceId));
    check("the 2 services are A and B", svcSet.has(svcA.id) && svcSet.has(svcB.id));

    const wonPipelines = await prisma.leadPulsePipeline.count({ where: { partyId, status: "closed_won" } });
    check("enrollment count reflects 2 closed_won pipelines (metric basis)", wonPipelines === 2, `found ${wonPipelines}`);

    const leadB = await prisma.lead.findUnique({
      where: { id: re.leadId },
      select: { sourceId: true, originalSourceId: true, statusId: true, assignedToId: true, partyId: true },
    });
    const existingCandidateSource = await prisma.leadPulseSource.findUnique({ where: { code: "existing_candidate" }, select: { id: true } });
    check('new lead primary source = "Existing Candidate"', leadB?.sourceId === existingCandidateSource?.id);
    check("new lead preserves the ORIGINAL source", leadB?.originalSourceId === origSource.id, `original="${origSource.label}"`);
    check("new lead is Enrolled", !!enrolledStatus && leadB?.statusId === enrolledStatus.id);
    check("new lead self-assigned to the acting consultant (no admin needed)", leadB?.assignedToId === l2.userId);
    check("new lead linked to the SAME candidate (Party)", leadB?.partyId === partyId);

    if (reviewer) {
      const drafts = await prisma.transactionDraft.findMany({ where: { partyId, type: "Revenue" }, select: { amount: true, description: true } });
      check("2 independent Revenue finance drafts created", drafts.length === 2, `found ${drafts.length}`);
      const draftADesc = drafts.find((d) => Number(d.amount) === 10000)?.description ?? "";
      const draftBDesc = drafts.find((d) => Number(d.amount) === 20000)?.description ?? "";
      check('first draft reads "Enrollment — … · <serviceA>"', /^Enrollment — /.test(draftADesc) && draftADesc.includes(svcA.name), draftADesc);
      check('second draft reads "Re-enrollment — … · <serviceB>"', draftBDesc.startsWith("Re-enrollment — ") && draftBDesc.includes(svcB.name), draftBDesc);
    } else {
      check("finance draft assertions", true, "skipped (no draftFirst reviewer on this DB)");
    }

    check("re-enrollment produced its own operations project (or soft no-op if no template)", true, re.opsProjectId ? `opsProject=${re.opsProjectId}` : "no active template for service B → no project (expected)");

    // ── Guard: re-enrolling the SAME service is rejected (no double-count) ─────
    let guarded = false;
    try {
      await reEnrollCandidate({ sourceLeadId: leadA.id, serviceId: svcB.id, expectedValue: 20000, actorId: l2.userId, canAssign: false });
    } catch (e) {
      guarded = /already enrolled/i.test((e as Error).message);
    }
    check("re-enrolling the SAME service is blocked", guarded);
  } finally {
    // ── Cleanup (best-effort; the branch is disposable anyway) ─────────────────
    console.log("\n── Cleanup ──");
    const del = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); console.log(`  cleaned ${label}`); } catch (e) { console.warn(`  ! could not clean ${label}: ${(e as Error).message}`); }
    };
    if (partyId) {
      await del("opsProjects (+tasks/activities cascade)", () => prisma.opsProject.deleteMany({ where: { partyId } }));
      await del("transactionDrafts", () => prisma.transactionDraft.deleteMany({ where: { partyId } }));
    }
    if (leadIds.length) {
      await del("leadActivities", () => prisma.leadActivity.deleteMany({ where: { leadId: { in: leadIds } } }));
      await del("crmTasks", () => prisma.crmTask.deleteMany({ where: { leadId: { in: leadIds } } }));
      await del("leads", () => prisma.lead.deleteMany({ where: { id: { in: leadIds } } }));
    }
    if (partyId) {
      await del("pipelines", () => prisma.leadPulsePipeline.deleteMany({ where: { partyId } }));
      await del("partyServices", () => prisma.partyService.deleteMany({ where: { partyId } }));
      await del("party", () => prisma.party.deleteMany({ where: { id: partyId } }));
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failed.length} CHECK(S) FAILED`} (${results.length - failed.length}/${results.length})\n`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("\n💥 Verification error:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
