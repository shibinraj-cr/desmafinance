/**
 * Flip the lead-assignment intro between Wabis and the Cloud API — the
 * `wa_lead_assigned_cloud_enabled` AppSetting row (see WA_LEAD_ASSIGNED_CLOUD_KEY
 * in src/lib/app-settings.ts, consumed by isLeadAssignedCloudEnabled() in
 * src/lib/crm-webhook.ts).
 *
 * Deliberately a script, not a settings-page checkbox: this is a one-time
 * cutover decision for a single automation, not something toggled often enough
 * to earn UI. Reports the Cloud-credentials state either way, since turning
 * this on without them configured is a silent no-op (isLeadAssignedCloudEnabled
 * requires both).
 *
 *   npx tsx prisma/set-wa-lead-assigned-cloud.ts            # show current state
 *   npx tsx prisma/set-wa-lead-assigned-cloud.ts --on
 *   npx tsx prisma/set-wa-lead-assigned-cloud.ts --off
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const KEY = "wa_lead_assigned_cloud_enabled";

async function main() {
  const wantOn = process.argv.includes("--on");
  const wantOff = process.argv.includes("--off");
  if (wantOn && wantOff) {
    console.log("! pass at most one of --on / --off");
    return;
  }

  const [flagRow, phoneId, token] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: KEY } }),
    prisma.appSetting.findUnique({ where: { key: "wa_cloud_phone_number_id" } }),
    prisma.appSetting.findUnique({ where: { key: "wa_cloud_access_token" } }),
  ]);
  const cloudConfigured = !!(phoneId?.value.trim() || process.env.WA_CLOUD_PHONE_NUMBER_ID) &&
    !!(token?.value.trim() || process.env.WA_CLOUD_ACCESS_TOKEN);

  if (!wantOn && !wantOff) {
    console.log(`${KEY} = ${flagRow?.value ?? "(unset, treated as off)"}`);
    console.log(`Cloud credentials configured: ${cloudConfigured ? "yes" : "no"}`);
    console.log("\nPass --on or --off to change it.");
    return;
  }

  const value = wantOn ? "1" : "0";
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
  console.log(`✓ ${KEY} = ${value}`);
  if (wantOn && !cloudConfigured) {
    console.log("! Cloud credentials are NOT configured — the intro will keep going out via Wabis until they are.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
