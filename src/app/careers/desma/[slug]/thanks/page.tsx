import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicJob, isCareersPublic } from "@/lib/hiring/careers";

export const dynamic = "force-dynamic";

/**
 * The page a candidate lands on after applying.
 *
 * A real URL rather than a state swap inside the form, for three reasons: a
 * refresh or a back-button no longer re-renders a form that has already been
 * submitted; the address bar confirms something happened; and marketing can
 * point a Meta custom conversion at a URL, which is how ad platforms expect
 * conversions to be defined.
 */
export const metadata: Metadata = {
  title: "Application received — DESMA International",
  // Nothing here should be indexed: it is the tail of a private interaction,
  // and a thank-you page in search results is noise at best.
  robots: { index: false, follow: false },
};

export default async function ThanksPage({ params }: { params: { slug: string } }) {
  if (!(await isCareersPublic())) notFound();

  // The slug still has to be a real, live role — otherwise this is a page that
  // congratulates people for applying to something that does not exist.
  const job = await getPublicJob(params.slug);
  if (!job) notFound();

  return (
    <div className="mx-auto max-w-2xl px-md sm:px-lg py-xl">
      <div className="careers-card p-lg sm:p-xl text-center space-y-md">
        {/* Inline SVG, not an icon font: the careers shell is deliberately
            separate from the app and does not load Material Symbols, so a
            glyph name would render as the literal word. */}
        <div
          aria-hidden
          className="mx-auto h-14 w-14 rounded-full flex items-center justify-center"
          style={{ background: "var(--careers-yellow)" }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 12.5l5.5 5.5L20 7"
              stroke="var(--careers-grey-deep)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="space-y-xs">
          <h1 className="text-h1 careers-ink">Thank you — your application is in</h1>
          <p className="text-body-lg careers-muted">
            We have your application for{" "}
            <strong className="careers-ink">{job.title}</strong>.
          </p>
        </div>

        <div className="text-body-md careers-muted space-y-sm text-left sm:text-center">
          <p>
            A confirmation is on its way to the email address you gave us. If it is not there in a
            few minutes, check your spam folder.
          </p>
          <p>
            We read every application. If your experience lines up with what the role needs, someone
            from the team will contact you — usually within a week.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-sm pt-xs">
          <Link href="/careers/desma" className="careers-btn">
            See all open roles
          </Link>
          <a
            href="https://www.desma.in"
            target="_blank"
            rel="noopener noreferrer"
            className="text-label-sm"
          >
            About DESMA ↗
          </a>
        </div>

        <p className="text-caption careers-muted pt-xs">
          Questions about your application? Write to{" "}
          <a className="underline" href="mailto:hr@desma.in">
            hr@desma.in
          </a>
          .
        </p>
      </div>
    </div>
  );
}
