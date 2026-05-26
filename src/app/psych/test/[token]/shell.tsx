"use client";

import Image from "next/image";
import type { PsychLocale } from "@/lib/psych-i18n";
import { dict, t } from "@/lib/psych-i18n";

/**
 * Layout shell shared by welcome, question pages, review, thank-you,
 * and error screens. Loads Noto Sans Malayalam from Google Fonts via
 * a <link> in head — Tailwind config already maps `font-malayalam`.
 */
export function PageShell({
  locale,
  children,
}: {
  locale: PsychLocale;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-container-low">
      {/* Load Malayalam font (Noto Sans Malayalam) once for the whole page. */}
      <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
        crossOrigin=""
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+Malayalam:wght@400;500;700&display=swap"
      />
      <header className="bg-brand text-on-brand">
        <div className="max-w-3xl mx-auto px-md py-sm flex items-center gap-sm">
          <Image src="/desgro-letters.png" alt="DESGRO" width={120} height={28} priority />
          <div className={"ml-auto text-label-sm " + (locale === "ml" ? "font-malayalam" : "")}>
            {t(dict.test.title, locale)}
          </div>
        </div>
      </header>
      <main className={"max-w-3xl mx-auto px-md py-lg " + (locale === "ml" ? "font-malayalam" : "")}>
        {children}
      </main>
    </div>
  );
}

export function LanguageToggle({
  locale,
  onChange,
}: {
  locale: PsychLocale;
  onChange: (l: PsychLocale) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-outline-variant bg-surface overflow-hidden text-label-sm">
      <button
        type="button"
        onClick={() => onChange("en")}
        className={
          "px-md py-xs min-h-[44px] " +
          (locale === "en" ? "bg-primary text-on-primary font-bold" : "bg-transparent text-on-surface-variant")
        }
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => onChange("ml")}
        className={
          "px-md py-xs min-h-[44px] font-malayalam text-[16px] " +
          (locale === "ml" ? "bg-primary text-on-primary font-bold" : "bg-transparent text-on-surface-variant")
        }
      >
        ML
      </button>
    </div>
  );
}
