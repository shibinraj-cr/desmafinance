import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { findReferralLink } from "@/lib/crm-referral";
import { referrerFirstName } from "@/lib/crm-referral-link";
import { isOtherQualification } from "@/lib/crm";
import { ReferralForm } from "./referral-form";

export const dynamic = "force-dynamic";

function baseUrl(): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "desgro.in";
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  return `${proto}://${host}`;
}

const DESCRIPTION = "Leave your details and the DESMA International team will contact you on WhatsApp.";

/** One lookup per request, shared by the metadata and the page. */
const linkFor = cache(findReferralLink);

/** The greeting — only an active link names the candidate who shared it. */
async function inviterOf(code: string): Promise<{ found: boolean; firstName: string | null }> {
  const link = await linkFor(code);
  if (!link) return { found: false, firstName: null };
  return { found: true, firstName: link.active ? referrerFirstName(link.referrerLead.candidateName) : null };
}

// What WhatsApp shows when the link is pasted into a group: a title naming the
// friend who shared it, one line, and the logo.
export async function generateMetadata({ params }: { params: { code: string } }): Promise<Metadata> {
  const { found, firstName } = await inviterOf(params.code);
  const title = !found
    ? "DESMA International"
    : firstName
      ? `${firstName} invited you to DESMA International`
      : "You're invited to DESMA International";
  return {
    metadataBase: new URL(baseUrl()),
    title,
    description: DESCRIPTION,
    // A personal link, not a page for search engines.
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description: DESCRIPTION,
      type: "website",
      siteName: "DESMA International",
      images: [{ url: "/desma-logo.png", width: 200, height: 200, alt: "DESMA International" }],
    },
  };
}

export default async function ReferralPage({ params }: { params: { code: string } }) {
  const link = await linkFor(params.code);
  if (!link) notFound();

  const [qualifications, services] = await Promise.all([
    prisma.crmQualification.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true },
    }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const firstName = link.active ? referrerFirstName(link.referrerLead.candidateName) : null;

  return (
    <div className="mx-auto max-w-xl px-md py-xl space-y-lg">
      <header className="space-y-sm">
        {firstName && <span className="careers-chip">Invited by {firstName}</span>}
        <h1 className="text-h1 careers-ink">
          {firstName ? `${firstName} thinks DESMA can help you` : "Talk to DESMA International"}
        </h1>
        <p className="text-body-lg careers-muted">{DESCRIPTION}</p>
      </header>

      <div className="careers-card p-lg">
        <ReferralForm
          code={link.code}
          qualifications={qualifications.map((q) => ({ id: q.id, label: q.label, isOther: isOtherQualification(q.label) }))}
          services={services.map((s) => ({ id: s.id, label: s.name }))}
        />
      </div>
    </div>
  );
}
