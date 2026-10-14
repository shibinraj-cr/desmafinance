import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { phoneMatchKeys } from "@/lib/crm";
import { KEY_LOOKUP_BATCH } from "@/lib/crm-meta-reconcile";

export const dynamic = "force-dynamic";

// The page grant that gates this tool. System admins pass canSeePage() by
// default; the "Marketing Admin" role is granted this href explicitly.
const META_RECONCILE_PAGE = "/crm/meta-reconcile";

const Key = z.string().trim().min(1).max(320);
const BodySchema = z
  .object({
    emailKeys: z.array(Key).default([]),
    phoneKeys: z.array(Key).default([]),
  })
  .refine((b) => b.emailKeys.length + b.phoneKeys.length <= KEY_LOOKUP_BATCH, {
    message: `At most ${KEY_LOOKUP_BATCH} keys per request`,
  });

// POST /api/crm/meta-reconcile — which of these match keys already belong to a
// CRM lead. The browser parses the Meta export and buckets the rows itself (see
// src/lib/crm-meta-reconcile.ts for why the file never comes here), batching its
// keys so no request nears Vercel's 4.5 MB body cap. Read-only: NOTHING is written.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canSeePage(perms, META_RECONCILE_PAGE)) throw forbidden();

  const { emailKeys, phoneKeys } = BodySchema.parse(await req.json().catch(() => null));

  // A handful of `IN` queries instead of one lookup per key.
  const asked = new Set(phoneKeys);
  const existingEmail = new Set<string>();
  const existingPhone = new Set<string>();
  const CHUNK = 2000;
  for (let i = 0; i < emailKeys.length; i += CHUNK) {
    const part = emailKeys.slice(i, i + CHUNK);
    const found = await prisma.lead.findMany({ where: { emailKey: { in: part } }, select: { emailKey: true } });
    for (const f of found) if (f.emailKey) existingEmail.add(f.emailKey);
  }
  for (let i = 0; i < phoneKeys.length; i += CHUNK) {
    const part = phoneKeys.slice(i, i + CHUNK);
    const found = await prisma.lead.findMany({
      where: { OR: [{ phoneE164: { in: part } }, { altPhoneE164: { in: part } }] },
      select: { phoneE164: true, altPhoneE164: true },
    });
    // Echo back only numbers that were asked about, not a matched lead's other one.
    for (const f of found) {
      for (const k of phoneMatchKeys(f.phoneE164, f.altPhoneE164)) if (asked.has(k)) existingPhone.add(k);
    }
  }

  return NextResponse.json({ emailKeys: [...existingEmail], phoneKeys: [...existingPhone] });
});
