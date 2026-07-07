/**
 * Seed the previously hard-coded CRM email/WhatsApp templates into the
 * CrmMessageTemplate table so they show up in the /crm/templates manager and
 * become editable. Idempotent: a template is created only if one with the same
 * (channel, name) doesn't already exist, so re-running never duplicates or
 * overwrites edits.
 *
 *   npx tsx prisma/seed-crm-message-templates.ts        # or: npm run db:seed-crm-templates
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Seed = { channel: "email" | "whatsapp"; name: string; subject: string | null; body: string };

const TEMPLATES: Seed[] = [
  {
    channel: "email",
    name: "Introduction",
    subject: "DESMA — {service}",
    body: "Hi {name},\n\nThank you for your interest in {service}. I'm {consultant} from DESMA and I'll be assisting you.\n\nBest regards,\n{consultant}",
  },
  {
    channel: "email",
    name: "Follow up",
    subject: "Following up — {service}",
    body: "Hi {name},\n\nJust following up on our earlier conversation regarding {service}. Do let me know a good time to connect.\n\n{consultant}",
  },
  {
    channel: "email",
    name: "Not responding / Unavailable",
    subject: "We tried to reach you — Australian Nursing Registration",
    body: "Dear Candidate,\n\nWe tried reaching you on the phone number you provided, but unfortunately, we couldn't get through.\n\nIf you're still interested in pursuing the Australian Nursing Registration process, please feel free to call or WhatsApp us at +91 79949 20775. Our team will be happy to assist you.\n\nWe look forward to hearing from you.\n\nThank you,\nTeam DESMA",
  },
  {
    channel: "whatsapp",
    name: "DESMA — save my number",
    subject: null,
    body:
      "Hi {name} 😊,\n\n" +
      "This is {consultant} from DESMA International.\n\n" +
      "We help nurses like you through the Australian Nursing Registration process — step by step, stress-free.\n\n" +
      "👉 Please save my number now to get all important updates.\n\n" +
      "Once done, reply “SAVED” so I can assist you further.\n\n" +
      "Got any questions?\n" +
      "📞 I HAVE BOTIM. Call me NOW — I’m just a ping away to help you get started!",
  },
];

async function main() {
  let created = 0;
  let skipped = 0;
  for (const t of TEMPLATES) {
    const existing = await prisma.crmMessageTemplate.findFirst({
      where: { channel: t.channel, name: t.name },
      select: { id: true },
    });
    if (existing) {
      console.log(`• skip  [${t.channel}] "${t.name}" — already exists (${existing.id})`);
      skipped++;
      continue;
    }
    const row = await prisma.crmMessageTemplate.create({
      data: { channel: t.channel, name: t.name, subject: t.subject, body: t.body, isActive: true },
      select: { id: true },
    });
    console.log(`✓ create [${t.channel}] "${t.name}" (${row.id})`);
    created++;
  }
  console.log(`\ndone — ${created} created, ${skipped} already present.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
