import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireAgreementsUser } from "@/lib/esign/send";

export const dynamic = "force-dynamic";

/**
 * GET /api/esign/leads?q= — find the client to send an agreement to, by name,
 * email or phone. Agreement senders are often ops staff without CRM access, so
 * this returns only what the send wizard needs.
 */
export const GET = withApiHandler(async (req: Request) => {
  await requireAgreementsUser();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ leads: [] });
  const digits = q.replace(/\D/g, "");
  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        { candidateName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 4 ? [{ phoneE164: { contains: digits } }, { altPhoneE164: { contains: digits } }] : []),
      ],
    },
    orderBy: { lastActivityAt: "desc" },
    take: 20,
    select: {
      id: true,
      candidateName: true,
      email: true,
      phone: true,
      dob: true,
      expectedValue: true,
      service: { select: { name: true } },
    },
  });
  return NextResponse.json({
    leads: leads.map((l) => ({
      id: l.id,
      name: l.candidateName,
      email: l.email,
      phone: l.phone,
      dob: l.dob ? l.dob.toISOString().slice(0, 10) : null,
      expectedValue: l.expectedValue != null ? Number(l.expectedValue) : null,
      serviceName: l.service?.name ?? null,
    })),
  });
});
