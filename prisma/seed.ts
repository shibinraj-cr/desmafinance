import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const username = (process.env.ADMIN_USERNAME ?? "admin").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "ChangeMe!2026";
  const email = process.env.ADMIN_EMAIL ?? "admin@desma.local";

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, email, role: "admin" },
    create: { username, email, passwordHash, role: "admin" },
  });
  console.log(`✓ Admin user ready: ${user.username} (${user.email ?? "no email"})`);
  console.log(`  Use these credentials to sign in. Change the password via env then re-run seed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
