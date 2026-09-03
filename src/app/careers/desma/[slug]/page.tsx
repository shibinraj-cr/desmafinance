import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getPublicJob, getApplyForm, jobPostingJsonLd } from "@/lib/hiring/careers";
import { markdownToPlainText } from "@/lib/hiring/markdown";
import { Markdown } from "@/components/hiring/Markdown";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

function baseUrl(): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "desgro.in";
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  return `${proto}://${host}`;
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const job = await getPublicJob(params.slug);
  if (!job) return { title: "Role not found — DESMA International" };
  const description =
    markdownToPlainText(job.descriptionMd, 160) ||
    `${job.title} at DESMA International${job.locationName ? `, ${job.locationName}` : ""}.`;
  return {
    title: `${job.title} — Careers at DESMA International`,
    description,
    alternates: { canonical: `/careers/desma/${job.slug}` },
    openGraph: { title: job.title, description, type: "article" },
  };
}

export default async function CareersRolePage({ params }: { params: { slug: string } }) {
  const [job, form] = await Promise.all([getPublicJob(params.slug), getApplyForm(params.slug)]);
  if (!job || !form) notFound();

  const jsonLd = jobPostingJsonLd(job, baseUrl());

  return (
    <div className="mx-auto max-w-3xl px-md sm:px-lg py-xl space-y-xl">
      {/* Search engines read this; without it the role never shows up in a
          Google Jobs listing. Built from the same object the page renders. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav>
        <Link href="/careers/desma" className="text-label-sm text-on-surface-variant hover:text-on-surface">
          ← All open roles
        </Link>
      </nav>

      <header className="space-y-sm">
        <h1 className="text-h1 text-on-surface">{job.title}</h1>
        <div className="flex flex-wrap items-center gap-x-sm gap-y-xs text-body-md text-on-surface-variant">
          <span>{job.department}</span>
          {job.locationName && (
            <>
              <span aria-hidden>·</span>
              <span>{job.locationName}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{job.workTypeLabel}</span>
          <span aria-hidden>·</span>
          <span>{job.employmentTypeLabel}</span>
          <span aria-hidden>·</span>
          <span>{job.seniorityLabel}</span>
        </div>
        {job.compLabel && (
          <p className="text-body-md text-accent font-semibold">{job.compLabel}</p>
        )}
      </header>

      {job.descriptionMd && (
        <section aria-label="About the role">
          <Markdown source={job.descriptionMd} />
        </section>
      )}

      {job.mustHaves.length > 0 && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <h2 className="text-h3 text-on-surface mb-sm">What you need to have</h2>
          <ul className="list-disc pl-lg space-y-xs text-body-md text-on-surface-variant">
            {job.mustHaves.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {job.niceToHaves.length > 0 && (
            <>
              <h3 className="text-body-lg font-semibold text-on-surface mt-md mb-sm">
                Nice to have, not required
              </h3>
              <ul className="list-disc pl-lg space-y-xs text-body-md text-on-surface-variant">
                {job.niceToHaves.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section id="apply" className="scroll-mt-lg">
        <h2 className="text-h2 text-on-surface mb-md">Apply</h2>
        <ApplyForm
          jobId={form.jobId}
          jobTitle={form.title}
          resumeMode={form.resumeMode}
          questions={form.questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            helperText: q.helperText,
            answerType: q.answerType,
            required: q.required,
            options: Array.isArray(q.options) ? (q.options as string[]) : null,
          }))}
        />
      </section>
    </div>
  );
}
