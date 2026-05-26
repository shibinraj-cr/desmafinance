/** One-shot cleanup: deletes all PsychQuestion + PsychTest rows so
 *  seed-psych.ts can run fresh. Safe to run before any assignments
 *  have been issued. Run with: npx tsx prisma/reset-psych.ts */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.psychResponse.deleteMany();
  await prisma.psychReport.deleteMany();
  await prisma.psychAssignment.deleteMany();
  await prisma.psychQuestion.deleteMany();
  const tests = await prisma.psychTest.deleteMany();
  console.log(`Deleted ${tests.count} tests + all psych rows.`);
}
main().finally(() => prisma.$disconnect());
