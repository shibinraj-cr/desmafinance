"use client";

import { useState } from "react";
import type { PsychLocale, DictNode } from "@/lib/psych-i18n";
import { t } from "@/lib/psych-i18n";
import { LanguageToggle, PageShell } from "./shell";

export function ErrorScreen({
  titleNode,
  bodyNode,
  initialLocale,
  notFound,
}: {
  titleNode: DictNode;
  bodyNode: DictNode;
  initialLocale: PsychLocale;
  notFound?: boolean;
}) {
  const [locale, setLocale] = useState<PsychLocale>(initialLocale);
  return (
    <PageShell locale={locale}>
      <div className="flex justify-end mb-md">
        <LanguageToggle locale={locale} onChange={setLocale} />
      </div>
      <div className="rounded-lg border border-outline-variant bg-surface p-lg text-center">
        <div className={"text-h2 mb-sm " + (locale === "ml" ? "font-malayalam" : "")}>
          {t(titleNode, locale)}
        </div>
        <p className={"text-body-md text-on-surface-variant " + (locale === "ml" ? "font-malayalam text-[17px]" : "")}>
          {t(bodyNode, locale)}
        </p>
        {notFound && (
          <p className="text-caption text-on-surface-variant mt-md">
            Code: 404
          </p>
        )}
      </div>
    </PageShell>
  );
}
