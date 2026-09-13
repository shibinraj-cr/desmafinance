import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { loadSopAccess } from "@/lib/sop/access";
import {
  SOP_ADMIN_ANCHOR,
  SOP_CREATOR_ANCHOR,
  SOP_GOVERNANCE_ANCHORS,
  SOP_READER_PAGES,
} from "@/lib/sop/rbac";
import { Section, Td, Th } from "@/components/sop/ui";
import { NoAccess } from "../_no-access";
import { CategoriesClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Categories & Access — the SOP-admin surface.
 *
 * Granting a Desgro role this page is what MAKES someone a SOP admin (see
 * SOP_ADMIN_ANCHOR), the same trick /crm/settings and /operations/settings use.
 * The access table below is read-only on purpose: roles and page grants are
 * managed in Role Management, and a second editor for the same data is how the
 * two drift apart. This page explains what the grants mean and shows who holds
 * them today.
 */
export default async function SopSettingsPage() {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  if (!access.isSopAdmin) {
    return (
      <NoAccess
        title="Categories & Access"
        message="SOP settings are limited to SOP administrators."
        cta={{ href: "/sop/library", label: "Go to the SOP Library" }}
      />
    );
  }

  const [categories, roles] = await Promise.all([
    prisma.sopCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { sops: true } } },
    }),
    prisma.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isAdmin: true, pages: true } }),
  ]);

  const tiers = [
    {
      tier: "SOP Admin",
      grant: SOP_ADMIN_ANCHOR,
      what: "Publish, archive, manage categories, and see every SOP including restricted and archived ones.",
    },
    {
      tier: "SOP Creator",
      grant: SOP_CREATOR_ANCHOR,
      what: "Create SOPs and edit their own drafts.",
    },
    {
      tier: "Governance",
      grant: SOP_GOVERNANCE_ANCHORS.join(", "),
      what: "See the review queue, the KPI review screen and the acknowledgement register.",
    },
    {
      tier: "Everyone",
      grant: SOP_READER_PAGES.join(", "),
      what: "Read published SOPs they are entitled to, and acknowledge the ones assigned to them. No grant needed.",
    },
  ];

  return (
    <>
      <TopBar title="Categories & Access" subtitle="SOP administration" />
      <div className="p-margin space-y-lg">
        <Section
          title="SOP categories"
          description="How SOPs are classified. Used by the editor's category picker and the library filter."
        >
          <CategoriesClient
            categories={categories.map((c) => ({
              id: c.id,
              name: c.name,
              description: c.description,
              sortOrder: c.sortOrder,
              isActive: c.isActive,
              sopCount: c._count.sops,
            }))}
          />
        </Section>

        <Section
          title="Who can do what"
          description="SOP capability follows the page grants on each Desgro role, managed in Role Management. Granting a role a page here promotes it to the matching tier — no code change needed."
        >
          <div className="overflow-x-auto rounded-xl border border-outline-variant">
            <table className="w-full min-w-[44rem] border-collapse">
              <thead className="bg-surface-container-low border-b border-outline-variant">
                <tr>
                  <Th className="w-40">Tier</Th>
                  <Th className="w-72">Granted by</Th>
                  <Th>What it allows</Th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.tier} className="border-b border-outline-variant last:border-0">
                    <Td className="text-on-surface font-medium">{t.tier}</Td>
                    <Td className="font-mono text-label-sm text-on-surface-variant">{t.grant}</Td>
                    <Td className="text-on-surface-variant">{t.what}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="text-body-lg font-semibold text-on-surface mt-lg mb-sm">Roles today</h4>
          <div className="overflow-x-auto rounded-xl border border-outline-variant">
            <table className="w-full min-w-[40rem] border-collapse">
              <thead className="bg-surface-container-low border-b border-outline-variant">
                <tr>
                  <Th>Role</Th>
                  <Th className="w-32">SOP Admin</Th>
                  <Th className="w-32">Can create</Th>
                  <Th className="w-32">Governance</Th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => {
                  const isSopAdmin = r.isAdmin || r.pages.includes(SOP_ADMIN_ANCHOR);
                  const canCreate = isSopAdmin || r.pages.includes(SOP_CREATOR_ANCHOR);
                  const governance = isSopAdmin || SOP_GOVERNANCE_ANCHORS.some((p) => r.pages.includes(p));
                  return (
                    <tr key={r.id} className="border-b border-outline-variant last:border-0">
                      <Td className="text-on-surface">
                        {r.name}
                        {r.isAdmin && (
                          <span className="text-caption text-on-surface-variant"> · system admin</span>
                        )}
                      </Td>
                      <Td className="text-on-surface-variant">{isSopAdmin ? "Yes" : "—"}</Td>
                      <Td className="text-on-surface-variant">{canCreate ? "Yes" : "—"}</Td>
                      <Td className="text-on-surface-variant">{governance ? "Yes" : "—"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
