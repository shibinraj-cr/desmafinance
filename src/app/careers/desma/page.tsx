import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listPublicJobs, isCareersPublic, type PublicJob } from "@/lib/hiring/careers";
import { WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Careers at DESMA International",
  description:
    "Open roles at DESMA International — a nursing migration and registration consultancy based in Kerala, India.",
  alternates: { canonical: "/careers/desma" },
  openGraph: {
    title: "Careers at DESMA International",
    description: "Open roles at DESMA International, Kerala.",
    type: "website",
  },
};

export default async function CareersIndexPage({
  searchParams,
}: {
  searchParams: { location?: string; workType?: string };
}) {
  // Off by default: the careers site is published deliberately, not as a side
  // effect of deploying the module.
  if (!(await isCareersPublic())) notFound();

  const all = await listPublicJobs();

  const locations = [...new Set(all.map((j) => j.locationName).filter(Boolean))].sort() as string[];
  const location = searchParams.location && locations.includes(searchParams.location) ? searchParams.location : null;
  const workType =
    searchParams.workType && (WORK_TYPES as readonly string[]).includes(searchParams.workType)
      ? (searchParams.workType as WorkType)
      : null;

  const jobs = all.filter(
    (j) => (!location || j.locationName === location) && (!workType || j.workType === workType),
  );
  const byDepartment = groupByDepartment(jobs);
  const filtered = location != null || workType != null;

  return (
    <div className="mx-auto max-w-4xl px-md sm:px-lg py-xl space-y-xl">
      <section className="space-y-md">
        <h1 className="text-h1 careers-ink">Work with us</h1>
        <p className="text-body-lg careers-muted max-w-prose">
          DESMA International helps nurses in India register and build careers abroad — AHPRA, NMC,
          CGFNS and the rest of it. The work is detailed and it matters to the person on the other
          end of it. We hire people who like both of those things.
        </p>
      </section>

      {all.length > 0 && (locations.length > 1 || hasMultipleWorkTypes(all)) && (
        <section aria-label="Filter roles" className="space-y-sm">
          {locations.length > 1 && (
            <FilterRow
              label="Place"
              options={[
                { href: buildHref(null, workType), label: "Anywhere", active: !location },
                ...locations.map((l) => ({
                  href: buildHref(l, workType),
                  label: l,
                  active: location === l,
                })),
              ]}
            />
          )}
          {hasMultipleWorkTypes(all) && (
            <FilterRow
              label="Work type"
              options={[
                { href: buildHref(location, null), label: "Any", active: !workType },
                ...[...new Set(all.map((j) => j.workType))].map((w) => ({
                  href: buildHref(location, w as WorkType),
                  label: WORK_TYPE_LABELS[w as WorkType] ?? w,
                  active: workType === w,
                })),
              ]}
            />
          )}
        </section>
      )}

      {all.length === 0 ? (
        <EmptyState
          title="No open roles right now"
          body="We are not hiring at the moment. Check back — or write to us at hr@desma.in and tell us what you do; we keep good people in mind."
        />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="Nothing matches that filter"
          body="There are open roles, just not with these filters."
          action={{ href: "/careers/desma", label: "Show every open role" }}
        />
      ) : (
        <div className="space-y-xl">
          {!filtered && (
            <p className="text-body-sm careers-muted">
              {jobs.length} open {jobs.length === 1 ? "role" : "roles"}.
            </p>
          )}
          {byDepartment.map(([department, list]) => (
            <section key={department} className="space-y-sm">
              <h2 className="text-label-sm uppercase tracking-wider careers-muted">
                {department}
              </h2>
              <ul className="space-y-sm">
                {list.map((job) => (
                  <li key={job.slug} className="careers-card p-md">
                    <div className="flex flex-wrap items-start justify-between gap-md">
                      <div className="min-w-0">
                        <Link
                          href={`/careers/desma/${job.slug}`}
                          className="text-body-lg font-semibold careers-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--careers-brand-deep)] rounded"
                        >
                          {job.title}
                        </Link>
                        <div className="mt-xs flex flex-wrap items-center gap-x-sm gap-y-xs text-body-sm careers-muted">
                          {job.locationName && <span>{job.locationName}</span>}
                          {job.locationName && <span aria-hidden>·</span>}
                          <span>{job.workTypeLabel}</span>
                          <span aria-hidden>·</span>
                          <span>{job.employmentTypeLabel}</span>
                          {job.openings > 1 && (
                            <>
                              <span aria-hidden>·</span>
                              <span>{job.openings} openings</span>
                            </>
                          )}
                          {job.compLabel && <span className="careers-chip ml-xs">{job.compLabel}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-xs flex-shrink-0">
                        <Link href={`/careers/desma/${job.slug}`} className="careers-btn careers-btn-quiet">
                          Details
                        </Link>
                        {/* Straight to the form — the commonest thing somebody
                            wants from a job list is to apply to it. */}
                        <Link
                          href={`/careers/desma/${job.slug}#apply`}
                          className="careers-btn"
                          aria-label={`Apply for ${job.title}`}
                        >
                          Apply
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  options,
}: {
  label: string;
  options: { href: string; label: string; active: boolean }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-xs">
      <span className="text-label-sm careers-muted mr-xs">{label}</span>
      {options.map((o) => (
        <Link
          key={o.href + o.label}
          href={o.href}
          aria-current={o.active ? "true" : undefined}
          style={o.active ? { background: "var(--careers-brand-deep)" } : undefined}
          className={
            "h-8 inline-flex items-center px-md rounded-full text-label-sm border transition " +
            (o.active
              ? "text-white border-transparent"
              : "careers-border careers-muted hover:bg-white")
          }
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="careers-card border-dashed p-xl text-center">
      <div className="text-body-lg careers-ink mb-xs">{title}</div>
      <p className="text-body-sm careers-muted max-w-prose mx-auto">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="careers-btn mt-md"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

function buildHref(location: string | null, workType: string | null): string {
  const params = new URLSearchParams();
  if (location) params.set("location", location);
  if (workType) params.set("workType", workType);
  const qs = params.toString();
  return qs ? `/careers/desma?${qs}` : "/careers/desma";
}

function hasMultipleWorkTypes(jobs: PublicJob[]): boolean {
  return new Set(jobs.map((j) => j.workType)).size > 1;
}

function groupByDepartment(jobs: PublicJob[]): [string, PublicJob[]][] {
  const map = new Map<string, PublicJob[]>();
  for (const j of jobs) {
    if (!map.has(j.department)) map.set(j.department, []);
    map.get(j.department)!.push(j);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
