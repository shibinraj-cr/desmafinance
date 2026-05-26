import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

function generateTempPassword(): string {
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  return (
    pick(upper) + pick(upper) + pick(lower) + pick(lower) + pick(lower) +
    pick(lower) + pick(lower) + pick(lower) + pick(digits) + pick(digits)
  );
}

export type GeneratedCredentials = {
  username: string;
  temporaryPassword: string;
  userId: string;
  isReset: boolean;
};

export async function generateEssCredentials(args: {
  employeeId: string;
  actorUserId: string | null;
  channel?: "email" | "whatsapp" | "both" | null;
  roleId?: string | null;
  notes?: string | null;
}): Promise<GeneratedCredentials> {
  const employee = await prisma.employee.findUnique({
    where: { id: args.employeeId },
    select: { id: true, empCode: true, name: true, email: true, officialEmail: true, userId: true },
  });
  if (!employee) throw new Error("Employee not found");

  const username = employee.empCode.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!username) throw new Error("empCode produces an empty username slug");
  const tempPwd = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPwd, 10);

  let userId: string;
  let isReset = false;
  if (employee.userId) {
    await prisma.user.update({
      where: { id: employee.userId },
      data: { passwordHash, ...(args.roleId ? { roleId: args.roleId } : {}) },
    });
    userId = employee.userId;
    isReset = true;
  } else {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, ...(args.roleId ? { roleId: args.roleId } : {}) },
      });
      userId = existing.id;
      isReset = true;
    } else {
      const created = await prisma.user.create({
        data: {
          username,
          email: employee.officialEmail ?? employee.email ?? null,
          passwordHash,
          role: "employee",
          ...(args.roleId ? { roleId: args.roleId } : {}),
        },
        select: { id: true },
      });
      userId = created.id;
    }
    await prisma.employee.update({ where: { id: employee.id }, data: { userId } });
  }

  const tempHash = await bcrypt.hash(tempPwd, 4);
  await prisma.hrEssCredentialEvent.create({
    data: {
      employeeId: employee.id,
      action: isReset ? "reset" : "create",
      username,
      channel: args.channel ?? null,
      tempPasswordHash: tempHash,
      actorUserId: args.actorUserId,
      notes: args.notes ?? null,
    },
  });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: args.actorUserId,
      eventType: isReset ? "ess_credentials_reset" : "ess_credentials_created",
      entityType: "Employee",
      entityId: employee.id,
      metadata: { username, channel: args.channel ?? null },
    },
  });

  return { username, temporaryPassword: tempPwd, userId, isReset };
}
