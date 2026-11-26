import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";

export function PerformanceNoAccess({ title }: { title: string }) {
  return (
    <>
      <TopBar title={title} />
      <div className="p-margin">
        <Section title="">
          <div className="py-lg text-center text-on-surface-variant">
            Team Performance is available to Admin and HR Manager only.
          </div>
        </Section>
      </div>
    </>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="py-lg text-center text-body-md text-on-surface-variant">{children}</div>;
}

export function PerformerCard({
  kicker,
  name,
  detail,
  href,
}: {
  kicker: string;
  name: string | null;
  detail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg flex items-center gap-md hover:border-primary-container"
    >
      <div className="w-12 h-12 rounded-full bg-brand text-primary font-bold text-h3 flex items-center justify-center flex-none">
        {name ? name[0] : "–"}
      </div>
      <div className="min-w-0">
        <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{kicker}</p>
        <p className="text-h3 text-on-surface truncate">{name ?? "No data yet"}</p>
        <p className="text-caption text-on-surface-variant">{detail}</p>
      </div>
    </Link>
  );
}

export const thCls = "text-left text-label-sm uppercase tracking-wider text-on-surface-variant px-md py-sm whitespace-nowrap";
export const tdCls = "px-md py-sm border-t border-outline-variant whitespace-nowrap text-body-md";
export const numCls = " text-right font-mono";
