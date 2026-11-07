/**
 * Send signed sample Voxbay CDRs to the call-record webhook, for local testing.
 *
 *   VOXBAY_SIGNING_SECRET=whsec_… npx tsx scripts/voxbay-test.ts http://localhost:3000
 *
 * Options:
 *   --phone <number>  the customer number on both calls (default 9000000001).
 *                     Use a lead's number to see the calls on its Timeline.
 *   --test            send as Voxbay test sends (X-Voxbay-Test: true): logged, nothing filed.
 *   --yes             required to send real (non --test) calls to a non-local URL.
 *
 * Sends one incoming and one outgoing call, then re-sends the incoming one as
 * attempt 2 with the same event id, which the endpoint should answer as a
 * duplicate. The server must run with the same VOXBAY_SIGNING_SECRET.
 */
import { randomUUID } from "node:crypto";
import { signVoxbayPayload } from "../src/lib/voxbay-webhook";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** An instant as Voxbay writes it: ISO 8601 in IST with the offset, e.g. 2026-11-07T14:28:40+05:30. */
function istIso(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 19) + "+05:30";
}

async function send(base: string, secret: string, event: string, eventId: string, attempt: number, body: object, test: boolean) {
  const raw = JSON.stringify(body);
  const t = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${base.replace(/\/$/, "")}/api/crm/voxbay/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-voxbay-event": event,
      "x-voxbay-event-id": eventId,
      "x-voxbay-attempt": String(attempt),
      "x-voxbay-signature": `t=${t},v1=${signVoxbayPayload(secret, eventId, t, raw)}`,
      ...(test ? { "x-voxbay-test": "true" } : {}),
    },
    body: raw,
  });
  console.log(`${event} attempt ${attempt} → ${res.status} ${await res.text()}`);
}

async function main() {
  const base = process.argv[2];
  const secret = process.env.VOXBAY_SIGNING_SECRET?.trim();
  if (!base || base.startsWith("--")) throw new Error("usage: npx tsx scripts/voxbay-test.ts <base-url> [--phone N] [--test] [--yes]");
  if (!secret) throw new Error("set VOXBAY_SIGNING_SECRET to the secret the server runs with");
  const test = process.argv.includes("--test");
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(base);
  if (!local && !test && !process.argv.includes("--yes")) {
    throw new Error(`${base} isn't local, so these calls would be filed for real. Add --test, or --yes to send anyway.`);
  }

  const phone = arg("--phone") ?? "9000000001";
  const run = Date.now();
  const agent = {
    agent_name: "Test Agent",
    agent_email: "agent@example.com",
    agent_extension: "101",
    agent_phone_number: "9000000099",
    department_name: "Sales",
  };

  const inStart = new Date(run - 10 * 60_000);
  const incoming = {
    phone,
    name: "Sample Caller",
    call_id: `test-${run}-in`,
    call_status: "ANSWERED",
    did_number: "918000000000",
    total_duration: "00:03:05",
    conversation_duration: "165",
    recording_url: `https://example.com/recordings/test-${run}-in.mp3`,
    call_start_time: istIso(inStart),
    call_answered_time: istIso(new Date(inStart.getTime() + 20_000)),
    call_end_time: istIso(new Date(inStart.getTime() + 185_000)),
    ...agent,
    transfer_happened: "false",
    direction: "incoming",
  };

  const outStart = new Date(run - 5 * 60_000);
  const outgoing = {
    phone,
    call_id: `test-${run}-out`,
    call_status: "NOANSWER",
    did_number: "918000000000",
    conversation_duration: "0",
    call_start_time: istIso(outStart),
    call_end_time: istIso(new Date(outStart.getTime() + 30_000)),
    ...agent,
    transfer_happened: "false",
    c2c_param_1: "sample",
    direction: "outgoing",
  };

  const inEventId = `evt_test_${randomUUID()}`;
  await send(base, secret, "cdr.incoming", inEventId, 1, incoming, test);
  await send(base, secret, "cdr.outgoing", `evt_test_${randomUUID()}`, 1, outgoing, test);
  await send(base, secret, "cdr.incoming", inEventId, 2, incoming, test);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
