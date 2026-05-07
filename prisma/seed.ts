import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const username = (process.env.ADMIN_USERNAME ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const email = process.env.ADMIN_EMAIL || null;

  if (!username || !password) {
    console.error(
      "\n❌ ADMIN_USERNAME and ADMIN_PASSWORD must both be set in the environment.\n" +
        "   Edit your .env (or set Vercel env vars) and re-run.\n",
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("\n❌ ADMIN_PASSWORD must be at least 8 characters.\n");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
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
