import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireBank } from "@/lib/bank/access";
import { ERROR_LABEL, toBankError } from "@/lib/bank/errors";
import { logEvent } from "@/lib/bank/events";
import { redact } from "@/lib/bank/secrets";
import { syncIntegrationToSheet } from "@/lib/bank/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Schema = z.object({ integrationId: z.string().min(1) });

/** POST …/sheets-sync — push not-yet-synced transactions to the Google Sheet now. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const { integrationId } = Schema.parse(await req.json());
  try {
    const r = await syncIntegrationToSheet(integrationId);
    await logEvent({ integrationId, step: "sheets", message: `Manual Sheet sync — ${r.appended} appended, ${r.alreadyPresent} already present`, userId });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const err = toBankError(e);
    return NextResponse.json({ ok: false, message: `${ERROR_LABEL[err.code]} — ${redact(err.message)}` });
  }
});
