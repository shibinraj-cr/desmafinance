import { TopBar } from "@/components/TopBar";

/** What someone without the Agreements grant sees on a folders page. */
export function NoAccess() {
  return (
    <>
      <TopBar title="Agreement Folders" />
      <div className="p-margin text-body-md text-on-surface-variant">
        Agreement folders are open to admins and roles granted the Agreements page in Roles.
      </div>
    </>
  );
}
