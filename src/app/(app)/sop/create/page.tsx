import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { loadSopAccess } from "@/lib/sop/access";
import { editorOptions } from "@/lib/sop/queries";
import { NoAccess } from "../_no-access";
import { CreateSopClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Create SOP (§3).
 *
 * A short first step — the fields the SOP number and its ownership depend on —
 * rather than the whole builder on a blank record. The SOP and its V1.0 draft
 * are created on submit, and everything else is edited in the builder, which is
 * the same screen a revision is edited in.
 */
export default async function CreateSopPage() {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  if (!access.canCreate) {
    return (
      <NoAccess
        title="Create SOP"
        message="Creating SOPs is limited to SOP authors. Ask a SOP administrator to grant your role the Create SOP page if you need to write one."
        cta={{ href: "/sop/library", label: "Go to the SOP Library" }}
      />
    );
  }

  const options = await editorOptions();

  return (
    <>
      <TopBar title="Create SOP" subtitle="Start a new Standard Operating Procedure" />
      <div className="p-margin">
        <CreateSopClient options={options} />
      </div>
    </>
  );
}
