import Link from "next/link";
import { Section } from "@/components/Cards";
import { Pill } from "@/components/sales-training/ui";
import {
  GUIDE_FRESH_DAYS,
  GUIDE_GROUPS,
  guideLastUpdated,
  sectionUpdatedOn,
  type GuideBlock,
  type GuideChange,
  type GuideSection,
} from "@/lib/crm-guide";

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

/** `**Label**` → bold. The guide quotes on-screen labels that way. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-on-surface">
            {p}
          </strong>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Block({ b }: { b: GuideBlock }) {
  switch (b.kind) {
    case "text":
      return (
        <p className="text-body-md text-on-surface-variant">
          <Rich text={b.text} />
        </p>
      );
    case "steps":
      return (
        <div>
          {b.title && <p className="text-label-sm font-bold text-on-surface mb-xs">{b.title}</p>}
          <ol className="space-y-xs">
            {b.items.map((it, i) => (
              <li key={i} className="flex gap-sm text-body-md text-on-surface-variant">
                <span className="flex-none w-6 h-6 rounded-full bg-primary text-on-primary text-[12px] font-bold inline-flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="pt-[2px]">
                  <Rich text={it} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "tips":
      return (
        <div className="rounded-lg bg-green-50 border border-green-200 p-md">
          <p className="text-label-sm font-bold text-green-800 mb-xs">{b.title ?? "Good habits"}</p>
          <ul className="space-y-[4px]">
            {b.items.map((it, i) => (
              <li key={i} className="flex gap-xs text-body-md text-green-900">
                <span className="material-symbols-outlined text-[18px] flex-none">check_circle</span>
                <span>
                  <Rich text={it} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "warn":
      return (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-md">
          <p className="text-label-sm font-bold text-amber-800 mb-xs">{b.title ?? "Watch out"}</p>
          <ul className="space-y-[4px]">
            {b.items.map((it, i) => (
              <li key={i} className="flex gap-xs text-body-md text-amber-900">
                <span className="material-symbols-outlined text-[18px] flex-none">error</span>
                <span>
                  <Rich text={it} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "table":
      return (
        <div>
          {b.title && <p className="text-label-sm font-bold text-on-surface mb-xs">{b.title}</p>}
          <div className="overflow-x-auto rounded-lg border border-outline-variant">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-left">
                <tr>
                  {b.head.map((h) => (
                    <th key={h} className="px-sm py-xs text-label-sm font-bold text-on-surface-variant whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i} className="border-t border-outline-variant align-top">
                    {r.map((c, j) => (
                      <td key={j} className={"px-sm py-xs " + (j === 0 ? "font-semibold text-on-surface" : "text-on-surface-variant")}>
                        <Rich text={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
  }
}

/**
 * The whole guide: what's new, contents, then every section. `sections` is
 * already filtered to what this viewer can use; `changes` is filtered to match.
 */
export function CrmGuide({
  sections,
  changes,
  today,
  quiz,
}: {
  sections: GuideSection[];
  changes: GuideChange[];
  /** IST yyyy-mm-dd, for the "Updated" pills. */
  today: string;
  /** Link to the knowledge-check module, when there is one this viewer can take. */
  quiz?: { href: string; label: string } | null;
}) {
  const lastUpdated = guideLastUpdated(changes);
  const recent = changes.slice(0, 6);

  return (
    <div className="space-y-lg max-w-4xl">
      <Section title="">
        <div className="space-y-md">
          <div>
            <p className="text-h3 font-bold text-on-surface">How to use the CRM</p>
            <p className="text-body-md text-on-surface-variant mt-xs">
              Everything a BDE needs to work leads in DesGro, in the order you&apos;ll use it. The guide follows the CRM itself: stage
              names, time limits and rules below are read live from the CRM, and every new feature is added here as it ships.
            </p>
            {lastUpdated && <p className="text-label-sm text-on-surface-variant mt-xs">Last updated {fmtDate(lastUpdated)}</p>}
          </div>
          {quiz && (
            <Link
              href={quiz.href}
              className="flex items-center gap-sm rounded-lg border border-primary bg-primary/5 p-md hover:bg-primary/10"
            >
              <span className="material-symbols-outlined text-primary">quiz</span>
              <span className="flex-1 text-body-md text-on-surface">
                <strong className="font-semibold">Knowledge check:</strong> {quiz.label}
              </span>
              <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
            </Link>
          )}
          {recent.length > 0 && (
            <div>
              <p className="text-label-sm font-bold text-on-surface mb-xs">What&apos;s new</p>
              <ul className="space-y-xs">
                {recent.map((c, i) => (
                  <li key={i} className="flex flex-col sm:flex-row sm:gap-md text-body-md">
                    <span className="text-label-sm text-on-surface-variant whitespace-nowrap sm:w-24 flex-none pt-[2px]">{fmtDate(c.date)}</span>
                    <span className="text-on-surface-variant">
                      <a href={`#${c.section}`} className="font-semibold text-on-surface hover:text-primary">
                        {c.title}
                      </a>
                      {" — "}
                      <Rich text={c.detail} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      <Section title="Contents">
        <div className="grid sm:grid-cols-2 gap-md">
          {GUIDE_GROUPS.map((g) => {
            const inGroup = sections.filter((s) => s.group === g);
            if (inGroup.length === 0) return null;
            return (
              <div key={g}>
                <p className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wide mb-xs">{g}</p>
                <ul className="space-y-[2px]">
                  {inGroup.map((s) => (
                    <li key={s.id}>
                      <a href={`#${s.id}`} className="text-body-md text-on-surface hover:text-primary">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>

      {sections.map((s) => {
        const updated = sectionUpdatedOn(s.id, changes);
        const fresh = updated != null && daysBetween(updated, today) <= GUIDE_FRESH_DAYS;
        const open = s.pages.find((p) => !p.includes("["));
        return (
          <section
            key={s.id}
            id={s.id}
            className="scroll-mt-24 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg space-y-md"
          >
            <div className="flex flex-wrap items-start gap-sm">
              <div className="flex-1 min-w-0">
                <p className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wide">{s.group}</p>
                <h3 className="text-h3 text-on-surface flex items-center gap-sm flex-wrap">
                  {s.title}
                  {fresh && <Pill tone="blue">Updated {fmtDate(updated!)}</Pill>}
                </h3>
              </div>
              {open && (
                <Link href={open} className="text-label-sm font-bold text-primary inline-flex items-center gap-[2px] whitespace-nowrap pt-xs">
                  Open in CRM
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                </Link>
              )}
            </div>
            <p className="text-body-md text-on-surface">
              <Rich text={s.summary} />
            </p>
            {s.blocks.map((b, i) => (
              <Block key={i} b={b} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
