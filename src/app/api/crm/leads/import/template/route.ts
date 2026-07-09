import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";

export const dynamic = "force-dynamic";

const HEADERS = ["Candidate Name", "Email", "Phone", "Date of Birth", "Source", "Service", "Qualification", "Consultant", "Notes"];
const EXAMPLE = ["Asha Menon", "asha@example.com", "9876543210", "1998-05-21", "Meta", "", "Bachelor's", "", "Walk-in enquiry"];

// GET /api/crm/leads/import/template — downloadable CSV template (admin).
export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkImport) throw forbidden();

  const csv = [HEADERS.join(","), EXAMPLE.join(",")].join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="crm-leads-import-template.csv"',
    },
  });
});
