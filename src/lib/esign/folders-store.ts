import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { forbidden, unauthorized } from "@/lib/http-error";
import { AGREEMENTS_PAGE } from "@/lib/esign/requests";

/**
 * Server-side half of Agreements → Folders. Storage itself (head, delete,
 * serve) is shared with Finance Documents through finance-docs-store.ts.
 */

/**
 * Every folder API call goes through this. The Agreements grant is the rule:
 * whoever sends and tracks agreements can file, open and rename them.
 * Admins pass automatically (canSeePage).
 */
export async function requireAgreementFilesUser(): Promise<{ userId: string; isAdmin: boolean }> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  if (!perms || !canSeePage(perms, AGREEMENTS_PAGE)) throw forbidden();
  return { userId, isAdmin: perms.isAdmin };
}

/**
 * Deleting is admin-only. These are signed agreements, often the only copy
 * Desgro holds, so a mis-click by anyone who can send agreements should not be
 * able to remove one.
 */
export async function requireAgreementFilesAdmin(): Promise<{ userId: string }> {
  const { userId, isAdmin } = await requireAgreementFilesUser();
  if (!isAdmin) throw forbidden("Only an admin can delete filed agreements.");
  return { userId };
}

/** A folder with this name, compared the way a person reads names (case-blind). */
export async function agreementFolderNamed(name: string, exceptId?: string) {
  return prisma.agreementFolder.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
}
