import { Section } from "@/components/Cards";
import { TopBar } from "@/components/TopBar";
import { MODULE_STATUS_LABEL, type ModuleStatus } from "@/lib/sales-training";

export const inputCls = "px-sm py-sm rounded border border-outline-variant bg-surface text-body-md";
export const btnPrimary =
  "px-md py-sm rounded bg-primary text-on-primary font-bold text-label-sm disabled:opacity-50 inline-flex items-center gap-xs";
export const btnGhost =
  "px-md py-sm rounded border border-outline-variant text-on-surface text-label-sm hover:bg-surface-container disabled:opacity-50 inline-flex items-center gap-xs";

const TONES = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
  grey: "bg-surface-container text-on-surface-variant",
} as const;

export type Tone = keyof typeof TONES;

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={"px-sm py-[2px] rounded-full text-[11px] font-bold whitespace-nowrap " + TONES[tone]}>{children}</span>
  );
}

const STATUS_TONE: Record<ModuleStatus, Tone> = {
  not_started: "grey",
  in_progress: "amber",
  passed: "green",
  failed: "red",
};

export function ModuleStatusPill({ status }: { status: ModuleStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{MODULE_STATUS_LABEL[status]}</Pill>;
}

export function PublishPill({ status }: { status: string }) {
  const tone: Tone = status === "published" ? "green" : status === "archived" ? "grey" : "blue";
  return <Pill tone={tone}>{status === "published" ? "Live" : status === "archived" ? "Archived" : "Draft"}</Pill>;
}

export function NoAccess({ title }: { title: string }) {
  return (
    <>
      <TopBar title={title} />
      <div className="p-margin">
        <Section title="">
          <p className="py-lg text-center text-on-surface-variant">No access.</p>
        </Section>
      </div>
    </>
  );
}

/** Thin horizontal progress bar, 0–100. */
export function Bar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "green" }) {
  return (
    <div className="h-2 w-full rounded-full bg-surface-container overflow-hidden">
      <div
        className={"h-full rounded-full " + (tone === "green" ? "bg-green-600" : "bg-primary")}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}
