import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { todayIst } from "@/lib/lead-pulse-dates";
import { PC_FINANCE_PAGE, PROGRAM_CODES } from "@/lib/partner-commissions/constants";
import { nextRunDate } from "@/lib/partner-commissions/logic";
import { ENROLLMENT_INCLUDE, getAccess, getSettings, isoDate, serializeEnrollment } from "@/lib/partner-commissions/server";
import { PartnerCommissionsClient, type PcPageData } from "./client";

export const dynamic = "force-dynamic";

const n = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

export default async function PartnerCommissionsPage({ searchParams }: { searchParams?: { tab?: string; invoice?: string } }) {
  const access = await getAccess();
  if (!access) redirect("/login");
  if (!access.isFinance) redirect(access.programs.length ? "/crm/partner-enrollments" : "/finance/overview");

  const today = todayIst();
  const month = today.slice(0, 7);
  const [settings, partners, programs, enrollments, invoices, run, lastRun] = await Promise.all([
    getSettings(),
    prisma.commissionPartner.findMany({ orderBy: { name: "asc" } }),
    prisma.commissionProgram.findMany(),
    prisma.commissionEnrollment.findMany({ include: ENROLLMENT_INCLUDE, orderBy: { createdAt: "desc" } }),
    prisma.commissionInvoice.findMany({
      orderBy: [{ invoiceDate: "desc" }, { number: "desc" }],
      include: {
        lines: { orderBy: { position: "asc" } },
        partner: { select: { layout: true } },
        createdBy: { select: { username: true } },
        receipts: {
          orderBy: { createdAt: "asc" },
          include: { recordedBy: { select: { username: true } }, reviewedBy: { select: { username: true } } },
        },
      },
    }),
    prisma.commissionRun.findUnique({ where: { month } }),
    prisma.commissionRun.findFirst({ orderBy: { ranAt: "desc" } }),
  ]);

  // Settings-tab extras only an approver can use.
  const [grants, users, bdeCount] = access.canApprove
    ? await Promise.all([
        prisma.commissionEnrollGrant.findMany({ include: { user: { select: { username: true, isActive: true } } } }),
        prisma.user.findMany({ where: { isActive: true }, select: { id: true, username: true }, orderBy: { username: "asc" } }),
        prisma.leadPulseRole.count({ where: { active: true, role: { in: ["l1", "l2"] } } }),
      ])
    : [[], [], 0];

  const data: PcPageData = {
    today,
    userId: access.userId,
    canApprove: access.canApprove,
    settings: {
      issuerName: settings.issuerName,
      issuerAddress: settings.issuerAddress,
      issuerRegLine: settings.issuerRegLine,
      bankAccountName: settings.bankAccountName,
      bankCurrency: settings.bankCurrency,
      bankIban: settings.bankIban,
      bankBic: settings.bankBic,
      bankAccountNo: settings.bankAccountNo,
      signatoryName: settings.signatoryName,
      hasSignature: !!settings.signaturePng,
      numberPrefix: settings.numberPrefix,
      nextNumber: settings.nextNumber,
      runDay: settings.runDay,
      emailAlerts: settings.emailAlerts,
      bdePrograms: settings.bdePrograms,
    },
    partners: partners.map((p) => ({ id: p.id, name: p.name, address: p.address, email: p.email, forLine: p.forLine, layout: p.layout, isActive: p.isActive })),
    programs: PROGRAM_CODES.map((code) => {
      const p = programs.find((x) => x.code === code);
      return {
        code,
        configured: !!p,
        partnerId: p?.partnerId ?? null,
        courseName: p?.courseName ?? code,
        defaultFee: n(p?.defaultFee),
        defaultPct: n(p?.defaultPct),
        isActive: p?.isActive ?? false,
      };
    }),
    enrollments: enrollments.map(serializeEnrollment),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      partnerId: i.partnerId,
      layout: i.partner.layout,
      invoiceDate: isoDate(i.invoiceDate)!,
      paymentTerm: i.paymentTerm,
      currency: i.currency,
      billToName: i.billToName,
      billToAddress: i.billToAddress,
      billToEmail: i.billToEmail,
      billToFor: i.billToFor,
      amountWords: i.amountWords,
      status: i.status,
      source: i.source,
      sentAt: i.sentAt?.toISOString() ?? null,
      cancelledAt: i.cancelledAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      createdBy: i.createdBy?.username ?? null,
      lines: i.lines.map((l) => ({
        id: l.id,
        enrollmentId: l.enrollmentId,
        program: l.program,
        description: l.description,
        studentId: l.studentId,
        courseName: l.courseName,
        intakeMonth: l.intakeMonth,
        courseFee: Number(l.courseFee),
        commissionPct: Number(l.commissionPct),
        amount: Number(l.amount),
      })),
      receipts: i.receipts.map((r) => ({
        id: r.id,
        receivedOn: isoDate(r.receivedOn)!,
        audSettled: Number(r.audSettled),
        aedAmount: Number(r.aedAmount),
        inrAmount: Number(r.inrAmount),
        aedInrRate: Number(r.aedInrRate),
        reference: r.reference,
        settleInFull: r.settleInFull,
        skipLedger: r.skipLedger,
        status: r.status,
        recordedBy: r.recordedBy?.username ?? null,
        recordedAt: r.createdAt.toISOString(),
        reviewedBy: r.reviewedBy?.username ?? null,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        reviewNote: r.reviewNote,
        posted: r.postedTxIds.length,
      })),
    })),
    run: {
      ranThisMonth: !!run,
      nextRun: nextRunDate(today, settings.runDay, !!run),
      lastRunAt: lastRun?.ranAt.toISOString() ?? null,
      lastRunCount: lastRun?.invoiceIds.length ?? 0,
    },
    grants: grants
      .filter((g) => g.user.isActive)
      .map((g) => ({ userId: g.userId, username: g.user.username, programs: g.programs })),
    users,
    bdeCount,
  };

  const tab = ["enrollments", "invoices", "payments", "settings"].includes(searchParams?.tab ?? "") ? searchParams!.tab! : "enrollments";

  return (
    <>
      <TopBar title="Partner Commissions" subtitle="NCLEX · OSCE · GCAN" />
      <PartnerCommissionsClient data={data} initialTab={tab} initialInvoice={searchParams?.invoice ?? null} page={PC_FINANCE_PAGE} />
    </>
  );
}
