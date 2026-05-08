import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { SourcesEditor, NewSourceButton } from "./client";

export const dynamic = "force-dynamic";

/**
 * Sources master — open to any authenticated user (matches the
 * Candidate creation flow which needs Source picking + on-the-fly
 * additions). Backed by `LeadPulseSource` so the same list appears in
 * `/marketing/lead-pulse/settings`.
 */
export default async function SourcesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");

  const [sources, partyCounts] = await Promise.all([
    prisma.leadPulseSource.findMany({
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    }),
    prisma.party.groupBy({
      by: ["sourceId"],
      where: { sourceId: { not: null } },
      _count: true,
    }),
  ]);
  const partyCountMap = new Map<string, number>();
  for (const r of partyCounts) {
    if (r.sourceId) partyCountMap.set(r.sourceId, r._count);
  }

  return (
    <>
      <TopBar
        title="Sources"
        subtitle={`${sources.length} source${sources.length === 1 ? "" : "s"} · shared with Lead Pulse`}
        action={<NewSourceButton />}
      />
      <div className="p-margin space-y-lg">
        <SourcesEditor
          sources={sources.map((s) => ({
            id: s.id,
            code: s.code,
            label: s.label,
            displayOrder: s.displayOrder,
            active: s.active,
            partyCount: partyCountMap.get(s.id) ?? 0,
          }))}
        />
      </div>
    </>
  );
}
