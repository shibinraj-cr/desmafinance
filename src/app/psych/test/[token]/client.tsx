"use client";

import { useEffect, useMemo, useState } from "react";
import { dict, t, type PsychLocale } from "@/lib/psych-i18n";
import { LanguageToggle, PageShell } from "./shell";

type QuestionLite = { id: string; textEn: string; textMl: string | null };

const PAGE_SIZE = 5;

type Step = "welcome" | "test" | "review" | "thanks";

export function TestClient({
  rawToken,
  employeeName,
  initialLocale,
  questions,
  priorResponses,
}: {
  rawToken: string;
  employeeName: string;
  initialLocale: PsychLocale;
  questions: QuestionLite[];
  priorResponses: Record<string, number>;
}) {
  const [locale, setLocale] = useState<PsychLocale>(initialLocale);
  const [step, setStep] = useState<Step>(
    Object.keys(priorResponses).length > 0 ? "test" : "welcome",
  );
  const [consented, setConsented] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [responses, setResponses] = useState<Record<string, number>>(priorResponses);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);

  // Persist language pick across reloads.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("psych:locale") as PsychLocale | null;
      if (stored === "en" || stored === "ml") setLocale(stored);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("psych:locale", locale);
    } catch {}
  }, [locale]);

  const totalPages = Math.max(1, Math.ceil(questions.length / PAGE_SIZE));
  const currentPageQs = useMemo(() => {
    const start = pageIdx * PAGE_SIZE;
    return questions.slice(start, start + PAGE_SIZE);
  }, [questions, pageIdx]);
  const answeredCount = Object.keys(responses).length;

  async function saveProgress(toSave: Record<string, number>) {
    setSaving(true);
    try {
      const payload = Object.entries(toSave).map(([questionId, value]) => ({ questionId, value }));
      await fetch(`/api/psych/test/${rawToken}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ responses: payload }),
      });
    } catch {
      // Silent — server is authoritative on submit; user can keep going.
    } finally {
      setSaving(false);
    }
  }

  function selectAnswer(qid: string, value: number) {
    setResponses((r) => {
      const next = { ...r, [qid]: value };
      // fire-and-forget incremental save (just this answer)
      saveProgress({ [qid]: value });
      return next;
    });
  }

  function gotoNextPage() {
    const unanswered = currentPageQs.filter((q) => responses[q.id] == null);
    if (unanswered.length > 0) {
      setError(t(dict.test.answer_all, locale));
      return;
    }
    setError(null);
    if (pageIdx + 1 < totalPages) {
      setPageIdx(pageIdx + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setStep("review");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function gotoPrevPage() {
    setError(null);
    if (pageIdx > 0) setPageIdx(pageIdx - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function doSubmit() {
    setSaving(true);
    try {
      const payload = Object.entries(responses).map(([questionId, value]) => ({ questionId, value }));
      const res = await fetch(`/api/psych/test/${rawToken}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ responses: payload }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "submit failed");
        setSaving(false);
        return;
      }
      setConfirmOpen(false);
      setStep("thanks");
    } catch {
      setError("network error");
      setSaving(false);
    }
  }

  return (
    <PageShell locale={locale}>
      <div className="flex items-center justify-between mb-md">
        <div className={"text-label-sm text-on-surface-variant " + (locale === "ml" ? "font-malayalam text-[14px]" : "")}>
          {t(dict.test.hello, locale)}, <span className="font-bold text-on-surface">{employeeName}</span>
        </div>
        <LanguageToggle locale={locale} onChange={setLocale} />
      </div>

      {step === "welcome" && (
        <WelcomeScreen
          locale={locale}
          consented={consented}
          onConsent={setConsented}
          onStart={() => setStep("test")}
        />
      )}

      {step === "test" && (
        <TestScreen
          locale={locale}
          questions={currentPageQs}
          responses={responses}
          onSelect={selectAnswer}
          pageIdx={pageIdx}
          totalPages={totalPages}
          totalQuestions={questions.length}
          answeredCount={answeredCount}
          error={error}
          onNext={gotoNextPage}
          onPrev={gotoPrevPage}
          saving={saving}
        />
      )}

      {step === "review" && (
        <ReviewScreen
          locale={locale}
          questions={questions}
          responses={responses}
          onEdit={(qid) => {
            setEditTargetId(qid);
            const idx = questions.findIndex((q) => q.id === qid);
            setPageIdx(Math.floor(Math.max(0, idx) / PAGE_SIZE));
            setStep("test");
          }}
          onSubmit={() => setConfirmOpen(true)}
          editTargetId={editTargetId}
        />
      )}

      {step === "thanks" && <ThanksScreen locale={locale} />}

      {confirmOpen && (
        <ConfirmModal
          locale={locale}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={doSubmit}
          saving={saving}
          error={error}
        />
      )}
    </PageShell>
  );
}

function WelcomeScreen({
  locale,
  consented,
  onConsent,
  onStart,
}: {
  locale: PsychLocale;
  consented: boolean;
  onConsent: (v: boolean) => void;
  onStart: () => void;
}) {
  const ml = locale === "ml";
  return (
    <div className="rounded-lg bg-surface border border-outline-variant p-lg">
      <h2 className={"text-h2 mb-sm " + (ml ? "font-malayalam" : "")}>
        {t(dict.test.welcome, locale)}
      </h2>
      <p className={"text-on-surface-variant mb-md " + (ml ? "font-malayalam text-[17px]" : "")}>
        {t(dict.test.estimated, locale)}
      </p>
      <p className={"mb-lg " + (ml ? "font-malayalam text-[17px] leading-relaxed" : "leading-relaxed")}>
        {t(dict.test.instructions, locale)}
      </p>
      <label className="flex items-start gap-sm cursor-pointer mb-lg">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => onConsent(e.target.checked)}
          className="mt-1 h-5 w-5"
        />
        <span className={ml ? "font-malayalam text-[17px]" : ""}>{t(dict.test.consent, locale)}</span>
      </label>
      <button
        type="button"
        disabled={!consented}
        onClick={onStart}
        className={
          "px-lg py-sm min-h-[44px] rounded bg-primary text-on-primary font-bold disabled:opacity-40 " +
          (ml ? "font-malayalam text-[17px]" : "")
        }
      >
        {t(dict.test.start, locale)}
      </button>
    </div>
  );
}

function TestScreen(props: {
  locale: PsychLocale;
  questions: QuestionLite[];
  responses: Record<string, number>;
  onSelect: (qid: string, v: number) => void;
  pageIdx: number;
  totalPages: number;
  totalQuestions: number;
  answeredCount: number;
  error: string | null;
  onNext: () => void;
  onPrev: () => void;
  saving: boolean;
}) {
  const ml = props.locale === "ml";
  const pct = Math.round((props.answeredCount / props.totalQuestions) * 100);
  return (
    <div>
      <div className="mb-md">
        <div className="h-2 rounded-full bg-surface-container overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-xs text-caption text-on-surface-variant">
          {props.answeredCount} / {props.totalQuestions}
        </div>
      </div>

      <div className="space-y-md">
        {props.questions.map((q, i) => {
          const displayedEn = !q.textMl && props.locale === "ml";
          const text = props.locale === "ml" ? (q.textMl ?? q.textEn) : q.textEn;
          return (
            <div key={q.id} className="rounded-lg bg-surface border border-outline-variant p-md">
              <div className={"text-on-surface mb-sm " + (ml ? "font-malayalam text-[18px] leading-snug" : "text-body-lg")}>
                <span className="text-on-surface-variant mr-xs">
                  {props.pageIdx * PAGE_SIZE + i + 1}.
                </span>
                {text}
                {displayedEn && (
                  <span className="block text-caption text-on-surface-variant mt-xs font-malayalam">
                    {t(dict.test.translation_pending, props.locale)}
                  </span>
                )}
              </div>
              <LikertRow
                locale={props.locale}
                value={props.responses[q.id]}
                onChange={(v) => props.onSelect(q.id, v)}
              />
            </div>
          );
        })}
      </div>

      {props.error && (
        <p className={"mt-md text-error font-bold " + (ml ? "font-malayalam" : "")}>{props.error}</p>
      )}

      <div className="flex justify-between mt-lg">
        <button
          type="button"
          onClick={props.onPrev}
          disabled={props.pageIdx === 0}
          className={
            "px-md py-sm min-h-[44px] rounded border border-outline-variant disabled:opacity-40 " +
            (ml ? "font-malayalam" : "")
          }
        >
          {t(dict.test.back, props.locale)}
        </button>
        <button
          type="button"
          onClick={props.onNext}
          className={
            "px-lg py-sm min-h-[44px] rounded bg-primary text-on-primary font-bold " +
            (ml ? "font-malayalam" : "")
          }
        >
          {props.pageIdx + 1 < props.totalPages
            ? t(dict.test.next, props.locale)
            : t(dict.test.review, props.locale)}
        </button>
      </div>
    </div>
  );
}

function LikertRow({
  locale,
  value,
  onChange,
}: {
  locale: PsychLocale;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const ml = locale === "ml";
  const opts = [1, 2, 3, 4, 5] as const;
  return (
    <div className="grid grid-cols-5 gap-xs">
      {opts.map((v) => {
        const selected = value === v;
        const label = t(dict.test.likert[v], locale);
        return (
          <button
            type="button"
            key={v}
            onClick={() => onChange(v)}
            className={
              "rounded border min-h-[44px] px-xs py-sm text-center " +
              (selected
                ? "border-primary bg-primary/10 text-on-surface font-bold"
                : "border-outline-variant bg-surface text-on-surface-variant hover:border-on-surface-variant") +
              " " +
              (ml ? "font-malayalam text-[13px] leading-tight" : "text-label-sm leading-tight")
            }
          >
            <div className="text-h3 mb-xs">{v}</div>
            <div>{label}</div>
          </button>
        );
      })}
    </div>
  );
}

function ReviewScreen({
  locale,
  questions,
  responses,
  onEdit,
  onSubmit,
  editTargetId,
}: {
  locale: PsychLocale;
  questions: QuestionLite[];
  responses: Record<string, number>;
  onEdit: (qid: string) => void;
  onSubmit: () => void;
  editTargetId: string | null;
}) {
  const ml = locale === "ml";
  return (
    <div className="rounded-lg bg-surface border border-outline-variant p-md">
      <h2 className={"text-h2 mb-md " + (ml ? "font-malayalam" : "")}>
        {t(dict.test.review, locale)}
      </h2>
      <div className="space-y-sm max-h-[60vh] overflow-y-auto">
        {questions.map((q, i) => {
          const v = responses[q.id];
          const text = locale === "ml" ? (q.textMl ?? q.textEn) : q.textEn;
          return (
            <div
              key={q.id}
              className={
                "flex items-start gap-sm border-b border-outline-variant pb-xs " +
                (editTargetId === q.id ? "bg-primary/5" : "")
              }
            >
              <div className="text-on-surface-variant w-8 shrink-0">{i + 1}.</div>
              <div className={"flex-1 " + (ml ? "font-malayalam text-[16px] leading-snug" : "text-label-sm leading-snug")}>
                {text}
              </div>
              <div className="text-on-surface font-bold w-6 text-right">{v ?? "—"}</div>
              <button
                type="button"
                onClick={() => onEdit(q.id)}
                className="text-blue-700 underline text-label-sm shrink-0 min-h-[28px]"
              >
                {t(dict.test.edit, locale)}
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end mt-lg">
        <button
          type="button"
          onClick={onSubmit}
          className={
            "px-lg py-sm min-h-[44px] rounded bg-primary text-on-primary font-bold " +
            (ml ? "font-malayalam" : "")
          }
        >
          {t(dict.test.submit, locale)}
        </button>
      </div>
    </div>
  );
}

function ConfirmModal({
  locale,
  onCancel,
  onConfirm,
  saving,
  error,
}: {
  locale: PsychLocale;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
  error: string | null;
}) {
  const ml = locale === "ml";
  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-md"
      onClick={onCancel}
    >
      <div
        className="bg-surface rounded-xl shadow-2xl max-w-md w-full p-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={"text-h3 mb-sm " + (ml ? "font-malayalam" : "")}>
          {t(dict.test.confirm_submit_title, locale)}
        </h3>
        <p className={"text-on-surface-variant mb-lg " + (ml ? "font-malayalam text-[17px]" : "")}>
          {t(dict.test.confirm_submit_body, locale)}
        </p>
        {error && <p className="text-error text-label-sm mb-sm">{error}</p>}
        <div className="flex justify-end gap-sm">
          <button
            type="button"
            onClick={onCancel}
            className={
              "px-md py-sm min-h-[44px] rounded border border-outline-variant " +
              (ml ? "font-malayalam" : "")
            }
          >
            {t(dict.test.cancel, locale)}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className={
              "px-md py-sm min-h-[44px] rounded bg-primary text-on-primary font-bold disabled:opacity-40 " +
              (ml ? "font-malayalam" : "")
            }
          >
            {t(dict.test.confirm_yes, locale)}
          </button>
        </div>
      </div>
    </div>
  );
}

function ThanksScreen({ locale }: { locale: PsychLocale }) {
  const ml = locale === "ml";
  return (
    <div className="rounded-lg bg-surface border border-outline-variant p-lg text-center">
      <h2 className={"text-h2 mb-sm " + (ml ? "font-malayalam" : "")}>
        {t(dict.test.thank_you_title, locale)}
      </h2>
      <p className={"text-on-surface-variant " + (ml ? "font-malayalam text-[17px]" : "")}>
        {t(dict.test.thank_you_body, locale)}
      </p>
    </div>
  );
}
