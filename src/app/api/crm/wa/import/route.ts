import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { importWabisHistory } from "@/lib/wa/wabis-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const Schema = z.object({
  /** Fetch and report, write nothing. */
  dryRun: z.boolean().default(true),
  maxSubscribers: z.number().int().min(1).max(500).default(25),
  onlyPhone: z.string().max(30).nullable().optional(),
  /** Sweep from the first contact again rather than resuming. */
  restart: z.boolean().default(false),
});

/**
 * POST /api/crm/wa/import — pull conversation history out of Wabis.
 *
 * Admin-only and manual. Deliberately not a cron: it is a one-off migration
 * step, not an ongoing sync, and something that rewrites conversation history on
 * a schedule is a much bigger promise than anything here intends to make.
 *
 * `dryRun` defaults TRUE — including when the field is absent — because the
 * response shape of Wabis's API is undocumented and the first run exists to
 * discover it. A caller has to ask for a write explicitly.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const opts = Schema.parse(await req.json().catch(() => ({})));
  const summary = await importWabisHistory({
    dryRun: opts.dryRun,
    maxSubscribers: opts.maxSubscribers,
    onlyPhone: opts.onlyPhone?.trim() || null,
    restart: opts.restart,
  });

  return NextResponse.json(summary);
});
