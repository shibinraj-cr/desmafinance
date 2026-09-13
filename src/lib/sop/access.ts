/**
 * The one DB-touching wrapper around `getSopAccess`.
 *
 * `rbac.ts` stays pure (and therefore testable); this file is the single place
 * that goes to the database for the viewer's employee context. Every page and
 * every API route in the module calls `loadSopAccess()` and nothing else, so
 * there is one query shape and one answer.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { unauthorized } from "@/lib/http-error";
import { getSopAccess, type SopAccess, type SopEmployeeContext } from "./rbac";

/** The viewer's employee record, departments, and the departments they head. */
export async function sopEmployeeContext(userId: string): Promise<SopEmployeeContext> {
  const employee = await prisma.employee.findUnique({
    where: { userId },
    select: {
      id: true,
      departments: { select: { departmentId: true } },
      headOfDepartments: { select: { id: true } },
    },
  });
  if (!employee) return null;
  return {
    employeeId: employee.id,
    departmentIds: employee.departments.map((d) => d.departmentId),
    headOfDepartmentIds: employee.headOfDepartments.map((d) => d.id),
  };
}

/**
 * Resolve the signed-in user's SOP access. Returns null when there is no
 * session — callers redirect (pages) or throw 401 (routes).
 */
export async function loadSopAccess(): Promise<SopAccess | null> {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return null;
  return getSopAccess(userId, perms, await sopEmployeeContext(userId));
}

/** Route-handler flavour: 401 rather than null. */
export async function requireSopAccess(): Promise<SopAccess> {
  const access = await loadSopAccess();
  if (!access) throw unauthorized();
  return access;
}
