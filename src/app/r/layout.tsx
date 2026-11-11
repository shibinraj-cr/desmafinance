import Image from "next/image";
import Link from "next/link";

/**
 * The public referral shell (/r/<code>).
 *
 * Not the Desgro app shell: whoever opens a candidate's link is a stranger, and
 * the page should look like DESMA, not the inside of an ERP. It borrows the
 * careers site's `.careers-theme` palette (globals.css) — DESMA's yellow and
 * grey, sampled from the logo — so both public faces of DESMA match.
 */
export default function ReferralLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="careers-theme min-h-screen flex flex-col">
      <div className="careers-rule" aria-hidden />

      <header className="careers-surface border-b careers-border">
        <div className="mx-auto max-w-xl px-md py-md flex items-center gap-sm">
          <Image
            src="/desma-logo.png"
            alt="DESMA International"
            width={40}
            height={40}
            className="h-10 w-10 flex-shrink-0"
            priority
          />
          <span className="text-body-lg font-extrabold careers-ink leading-tight">DESMA International</span>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="careers-surface border-t careers-border mt-xl">
        <div className="mx-auto max-w-xl px-md py-lg text-caption careers-muted space-y-xs">
          <p>
            DESMA International Private Limited · Aroor, Kerala, India ·{" "}
            <a className="underline" href="mailto:hello@desma.in">
              hello@desma.in
            </a>
          </p>
          <p>
            <Link className="underline" href="/privacy-policy">
              How we handle your data
            </Link>
            {" · "}
            <Link className="underline" href="/terms">
              Terms
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
