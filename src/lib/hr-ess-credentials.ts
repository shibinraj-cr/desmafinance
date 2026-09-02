import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

async function generateUsernameFromName(name: string): Promise<string> {
  const words = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0] ?? "";
  if (!first) throw new Error("Employee name produces an empty username slug");

  const candidates = [first];
  if (words.length > 1) candidates.push(first + words[1][0]);
  for (const candidate of candidates) {
    if (!(await prisma.user.findUnique({ where: { username: candidate } }))) return candidate;
  }
  for (let n = 2; ; n++) {
    const candidate = `${first}${n}`;
    if (!(await prisma.user.findUnique({ where: { username: candidate } }))) return candidate;
  }
}

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
    select: { id: true, name: true, email: true, officialEmail: true, userId: true },
  });
  if (!employee) throw new Error("Employee not found");

  const tempPwd = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPwd, 10);

  let userId: string;
  let username: string;
  let isReset = false;
  if (employee.userId) {
    const updated = await prisma.user.update({
      where: { id: employee.userId },
      data: { passwordHash, ...(args.roleId ? { roleId: args.roleId } : {}) },
      select: { id: true, username: true },
    });
    userId = updated.id;
    username = updated.username;
    isReset = true;
  } else {
    username = await generateUsernameFromName(employee.name);
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
