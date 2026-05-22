import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";

export default function Page() {
  return (
    <>
      <TopBar title="Payslips" subtitle="Coming soon" />
      <div className="p-margin">
        <Section title="">
          <p className="py-lg text-center text-on-surface-variant">
            Download monthly payslips. Available after Phase 2 salary engine usage.
          </p>
        </Section>
      </div>
    </>
  );
}
