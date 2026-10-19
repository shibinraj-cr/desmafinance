import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";

/** Lead search for linking an enrollment to its CRM lead: name only, top 8. */
export const GET = withApiHandler(async (req: Request) => {
  await requireAccess("any");
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ leads: [] });
  const leads = await prisma.lead.findMany({
    where: { candidateName: { contains: q, mode: "insensitive" } },
    orderBy: { lastActivityAt: "desc" },
    take: 8,
    select: { id: true, candidateName: true, phone: true, service: { select: { name: true } } },
  });
  return NextResponse.json({
    leads: leads.map((l) => ({
      id: l.id,
      name: l.candidateName,
      hint: [l.service?.name, l.phone ? `…${l.phone.replace(/\D/g, "").slice(-4)}` : null].filter(Boolean).join(" · "),
    })),
  });
});
