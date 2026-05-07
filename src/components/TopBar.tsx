import Link from "next/link";

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="sticky top-0 z-40 flex justify-between items-center w-full px-margin h-16 bg-surface/90 backdrop-blur border-b border-outline-variant">
      <div className="flex items-baseline gap-md">
        <h2 className="text-h2 text-on-surface font-extrabold">{title}</h2>
        {subtitle && <span className="text-body-md text-on-surface-variant">{subtitle}</span>}
      </div>
      <div className="flex items-center gap-md">
        <Link
          href="/daily-tracker/new"
          className="hidden sm:inline-flex items-center gap-xs h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            add
          </span>
          New transaction
        </Link>
      </div>
    </header>
  );
}
