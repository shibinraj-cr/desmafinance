import Link from "next/link";
import { TopBar } from "@/components/TopBar";

/**
 * The module's one "you cannot open this" screen.
 *
 * It always offers somewhere to go: a dead end that only says no is how people
 * conclude a feature is broken rather than not theirs. Every page that renders
 * this has already made the real authorisation decision server-side — this is
 * the explanation, not the enforcement.
 */
export function NoAccess({
  title,
  message,
  cta,
}: {
  title: string;
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <>
      <TopBar title={title} subtitle="SOP Management" />
      <div className="p-margin">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-xl max-w-2xl">
          <span className="material-symbols-outlined text-outline" style={{ fontSize: 36 }}>
            lock
          </span>
          <p className="text-body-lg text-on-surface mt-sm">{message}</p>
          {cta && (
            <Link
              href={cta.href}
              className="inline-flex items-center gap-xs mt-lg h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition"
            >
              {cta.label}
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                arrow_forward
              </span>
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
