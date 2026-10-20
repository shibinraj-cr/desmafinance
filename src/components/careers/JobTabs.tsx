"use client";

import { useState } from "react";
import { Markdown } from "@/components/hiring/Markdown";
import type { JobSection, TabName } from "@/lib/hiring/job-sections";

/**
 * The job description, as tabs on a wide screen and an accordion on a narrow
 * one. Most applicants arrive on a phone, where a horizontal tab strip over
 * several hundred words of prose is worse than a list they can open.
 *
 * Both layouts render EVERY panel into the DOM and hide the inactive ones with
 * CSS. Nothing here is conditional on JavaScript state for its existence, so
 * search engines, the JobPosting structured data and a reader with JS disabled
 * all still see the whole description.
 *
 * Its own component rather than the app's `GroupTabs`, which is navigation
 * bound to pathname and RBAC — the careers shell deliberately imports no app
 * chrome.
 */
export function JobTabs({
  tabs,
}: {
  tabs: { name: TabName; sections: JobSection[] }[];
}) {
  const [active, setActive] = useState(0);

  return (
    <section aria-label="About the role">
      {/* Tabs — from sm up. */}
      <div className="hidden sm:block">
        <div role="tablist" aria-label="Job details" className="flex flex-wrap gap-xs border-b careers-border mb-lg">
          {tabs.map((t, i) => (
            <button
              key={t.name}
              role="tab"
              type="button"
              id={`jobtab-${i}`}
              aria-selected={active === i}
              aria-controls={`jobpanel-${i}`}
              onClick={() => setActive(i)}
              className={
                "min-h-11 px-md -mb-px border-b-2 font-semibold transition " +
                (active === i ? "careers-tab-on" : "careers-tab-off")
              }
            >
              {t.name}
            </button>
          ))}
        </div>

        {tabs.map((t, i) => (
          <div
            key={t.name}
            role="tabpanel"
            id={`jobpanel-${i}`}
            aria-labelledby={`jobtab-${i}`}
            hidden={active !== i}
          >
            {t.sections.map((s) => (
              <Section key={s.title} section={s} showTitle={t.sections.length > 1} />
            ))}
          </div>
        ))}
      </div>

      {/* Accordion — below sm. The first one starts open so the page is never
          a column of closed headings. */}
      <div className="sm:hidden space-y-xs">
        {tabs.map((t, i) => (
          <details key={t.name} open={i === 0} className="careers-card px-md py-sm">
            <summary className="min-h-11 flex items-center font-semibold careers-ink cursor-pointer">
              {t.name}
            </summary>
            <div className="pb-sm">
              {t.sections.map((s) => (
                <Section key={s.title} section={s} showTitle={t.sections.length > 1} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function Section({ section, showTitle }: { section: JobSection; showTitle: boolean }) {
  return (
    <div className="mb-lg last:mb-0">
      {showTitle && <h3 className="text-body-lg font-bold careers-ink mb-xs">{section.title}</h3>}
      <Markdown source={section.bodyMd} />
    </div>
  );
}
