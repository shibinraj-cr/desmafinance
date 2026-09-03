import Link from "next/link";

/**
 * The public careers shell. Deliberately NOT the app shell: there is no
 * session here, no sidebar, and no module switcher — a job applicant is a
 * stranger, and the page should look like a company careers site rather than
 * like the inside of someone's ERP.
 */
export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="border-b border-outline-variant bg-surface-container-lowest">
        <div className="mx-auto max-w-4xl px-md sm:px-lg py-md flex items-center justify-between gap-md">
          <Link href="/careers/desma" className="flex items-baseline gap-sm min-w-0">
            <span className="text-h3 font-extrabold text-on-surface truncate">
              DESMA International
            </span>
            <span className="text-label-sm text-on-surface-variant hidden sm:inline">Careers</span>
          </Link>
          <a
            href="https://www.desma.in"
            className="text-label-sm text-on-surface-variant hover:text-on-surface transition whitespace-nowrap"
          >
            About us ↗
          </a>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-outline-variant bg-surface-container-lowest">
        <div className="mx-auto max-w-4xl px-md sm:px-lg py-lg text-caption text-on-surface-variant space-y-xs">
          <p>
            DESMA International Private Limited · Aroor, Kerala, India ·{" "}
            <a className="underline hover:text-on-surface" href="mailto:hello@desma.in">
              hello@desma.in
            </a>
          </p>
          <p>
            We hire on experience, skills and what you tell us about your work.{" "}
            <Link className="underline hover:text-on-surface" href="/privacy-policy">
              How we handle your data
            </Link>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}
