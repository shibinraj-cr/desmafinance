import { inr } from "@/lib/format";

export function KpiCard({
  label,
  value,
  hint,
  tone = "default",
  trailing,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "primary" | "danger" | "success";
  trailing?: React.ReactNode;
}) {
  const toneCls =
    tone === "primary"
      ? "text-primary"
      : tone === "danger"
        ? "text-error"
        : tone === "success"
          ? "text-green-700"
          : "text-on-surface";
  return (
    <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-sm">
      <div className="flex items-start justify-between mb-sm">
        <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</p>
        {trailing}
      </div>
      <h3 className={"text-h1 font-semibold " + toneCls}>{typeof value === "number" ? inr(value) : value}</h3>
      {hint && <p className="text-caption text-on-surface-variant mt-md">{hint}</p>}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={"bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg " + className}>
      <div className="flex items-center justify-between mb-lg">
        <h4 className="text-h3 text-on-surface">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}
