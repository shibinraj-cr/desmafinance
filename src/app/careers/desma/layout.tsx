import Image from "next/image";
import Link from "next/link";

/**
 * The public careers shell.
 *
 * Deliberately NOT the Desgro app shell: no session, no sidebar, no module
 * switcher — a job applicant is a stranger, and this should look like DESMA's
 * own careers site rather than the inside of somebody's ERP. The palette is
 * scoped to `.careers-theme` (see globals.css) so nothing here can leak into
 * the rest of the app.
 */
export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="careers-theme min-h-screen flex flex-col">
      <div className="careers-rule" aria-hidden />

      <header className="careers-surface border-b careers-border">
        <div className="mx-auto max-w-4xl px-md sm:px-lg py-md flex items-center justify-between gap-md">
          <Link href="/careers/desma" className="flex items-center gap-sm min-w-0 !text-inherit">
            {/* The logo carries its own dark disc, so it sits on the light
                header without needing a plate behind it. */}
            <Image
              src="/desma-logo.png"
              alt="DESMA International"
              width={40}
              height={40}
              className="h-10 w-10 flex-shrink-0"
              priority
            />
            <span className="min-w-0">
              <span className="block text-body-lg font-extrabold careers-ink leading-tight truncate">
                DESMA International
              </span>
              <span className="block text-label-sm careers-muted leading-tight">Careers</span>
            </span>
          </Link>
          <a
            href="https://www.desma.in"
            className="text-label-sm whitespace-nowrap"
            target="_blank"
            rel="noopener noreferrer"
          >
            About us ↗
          </a>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="careers-surface border-t careers-border mt-xl">
        <div className="mx-auto max-w-4xl px-md sm:px-lg py-lg text-caption careers-muted space-y-xs">
          <p>
            DESMA International Private Limited · Aroor, Kerala, India ·{" "}
            <a className="underline" href="mailto:hr@desma.in">
              hr@desma.in
            </a>
          </p>
          <p>
            We hire on experience, skills and what you tell us about your work.{" "}
            <Link className="underline" href="/privacy-policy">
              How we handle your data
            </Link>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}
