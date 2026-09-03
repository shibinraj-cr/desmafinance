import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { formatHiringDateTime } from "@/lib/hiring/core";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/** Entity types worth offering as a filter — the §6 audited surfaces. */
const ENTITY_FILTERS = [
  { value: "", label: "Everything" },
  { value: "HiringJob", label: "Jobs" },
  { value: "HiringOffer", label: "Offers" },
  { value: "HiringPartner", label: "Partners" },
  { value: "HiringMember", label: "Roles & access" },
];

export default async function HiringAuditPage({
  searchParams,
}: {
  searchParams: { entity?: string; page?: string };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "team:manage")) {
    return (
      <>
        <TopBar title="Audit Log" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The hiring audit log is visible to the hiring Owner or HR Manager.
          </div>
        </div>
      </>
    );
  }

  const entity = ENTITY_FILTERS.some((f) => f.value === searchParams.entity)
    ? (searchParams.entity ?? "")
    : "";
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  const where = entity ? { entityType: entity } : {};
  const [rows, total] = await Promise.all([
    prisma.hiringAuditLog.findMany({
      where,
      include: { actor: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.hiringAuditLog.count({ where }),
  ]);
  const loadedAt = new Date().toISOString();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <TopBar title="Audit Log" subtitle="Every write on jobs, offers, partners and access" />
      <div className="p-margin space-y-md">
        <div className="flex flex-wrap items-center justify-between gap-md">
          <nav className="flex flex-wrap gap-xs" aria-label="Filter by entity">
            {ENTITY_FILTERS.map((f) => (
              <a
                key={f.value || "all"}
                href={`/hiring/settings/audit${f.value ? `?entity=${f.value}` : ""}`}
                className={
                  "h-8 inline-flex items-center px-md rounded-full text-label-sm border transition " +
                  (entity === f.value
                    ? "bg-primary text-on-primary border-primary"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
                }
              >
                {f.label}
              </a>
            ))}
          </nav>
          <RefreshBar loadedAt={loadedAt} label={`${total} entries`} />
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
            <div className="text-body-lg text-on-surface mb-xs">Nothing audited yet</div>
            <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">
              Publishing a job, sending an offer, inviting a sourcing partner or changing someone&rsquo;s
              hiring role all land here — with who did it, when, and what changed.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="text-left border-b border-outline-variant bg-surface-container-low">
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-lg py-sm">When</th>
                  <th className="px-md py-sm">Who</th>
                  <th className="px-md py-sm">Action</th>
                  <th className="px-md py-sm">Entity</th>
                  <th className="px-md py-sm">From</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant last:border-0">
                    <td className="px-lg py-sm whitespace-nowrap tabular-nums text-on-surface-variant">
                      {formatHiringDateTime(r.createdAt)}
                    </td>
                    <td className="px-md py-sm text-on-surface">{r.actor?.username ?? "System"}</td>
                    <td className="px-md py-sm">
                      <span className="font-mono text-label-sm">{r.action}</span>
                    </td>
                    <td className="px-md py-sm text-on-surface-variant">
                      <span className="text-label-sm">{r.entityType}</span>
                      <span className="block text-caption font-mono opacity-70">{r.entityId}</span>
                    </td>
                    <td className="px-md py-sm text-caption text-on-surface-variant">{r.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between text-body-sm text-on-surface-variant">
            <span>
              Page {page} of {pages}
            </span>
            <div className="flex gap-xs">
              {page > 1 && (
                <a
                  className="h-9 inline-flex items-center px-md rounded-lg border border-outline-variant hover:bg-surface-container-low"
                  href={`/hiring/settings/audit?${entity ? `entity=${entity}&` : ""}page=${page - 1}`}
                >
                  Newer
                </a>
              )}
              {page < pages && (
                <a
                  className="h-9 inline-flex items-center px-md rounded-lg border border-outline-variant hover:bg-surface-container-low"
                  href={`/hiring/settings/audit?${entity ? `entity=${entity}&` : ""}page=${page + 1}`}
                >
                  Older
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
