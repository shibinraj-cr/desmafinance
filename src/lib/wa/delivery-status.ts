/**
 * What happened to a message after we sent it.
 *
 * Every outbound row was stamped `sent` at the moment the transport accepted it
 * and then left alone forever, so the ticks in the inbox have always shown one
 * grey mark whatever the candidate's phone actually did. That is not a display
 * bug: Meta has been sending the answer to our webhook the whole time — statuses
 * arrive on the same subscription as messages — and the endpoint recognised them
 * as "not a message" and discarded them.
 *
 * The join is exact. A send returns a `wamid` and we store it on
 * `providerMessageId`, which is unique, so a callback names precisely one row.
 * No guessing by phone and timestamp, which is what the Wabis path has to do.
 *
 * TWO THINGS THIS CANNOT TELL YOU, both worth knowing before trusting a tick:
 * `read` only arrives if the recipient has read receipts switched on, so a
 * message sitting at `delivered` may well have been read; and Meta offers no way
 * to ask about the past, so this only ever describes messages sent from now on.
 */
import { prisma } from "../prisma";
import { logger } from "../logger";
import { parseWaTimestamp } from "./inbound";

export type WaDeliveryUpdate = {
  /** Meta's `wamid.…` — the message this is about. */
  providerMessageId: string;
  status: WaDeliveryState;
  occurredAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type WaDeliveryState = "sent" | "delivered" | "read" | "failed";

/**
 * How far a message got, so a late callback cannot walk it backwards.
 *
 * Meta does not promise ordering, and redelivery is routine — a `delivered`
 * arriving after a `read` is an ordinary Tuesday. Without a rank the last
 * callback to land would win and a message the candidate has read would quietly
 * revert to one tick.
 *
 * `failed` sits level with `delivered` on purpose. It is a terminal answer at
 * the same stage of the journey, so it can overwrite `sent` — which is genuinely
 * new information — but never `delivered` or `read`, because a message that
 * reached the phone did reach the phone whatever arrives afterwards.
 */
export const RANK: Record<WaDeliveryState, number> = {
  sent: 1,
  delivered: 2,
  failed: 2,
  read: 3,
};

/** Meta's vocabulary, and the couple of spellings relays use. */
export function normalizeDeliveryState(raw: unknown): WaDeliveryState | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "sent" || s === "accepted") return "sent";
  if (s === "delivered") return "delivered";
  if (s === "read" || s === "seen") return "read";
  if (s === "failed" || s === "error" || s === "undelivered") return "failed";
  // `deleted` and `warning` are real Meta statuses that say nothing about
  // delivery, so they are dropped rather than mapped onto something they do not
  // mean. Anything unrecognised gets the same treatment.
  return null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pick(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Pull every delivery status out of a webhook body.
 *
 * Meta nests them at `entry[].changes[].value.statuses[]`. The flatter shapes are
 * accepted too, the same way the inbound parser does, because a relay in front of
 * us is a configuration this team already runs and a status silently ignored
 * because of an envelope is exactly the failure this whole module exists to end.
 */
export function extractDeliveryStatuses(body: unknown): WaDeliveryUpdate[] {
  const out: WaDeliveryUpdate[] = [];
  const seen = new Set<string>();

  const consider = (raw: unknown) => {
    const o = asObject(raw);
    if (!o) return;

    const status = normalizeDeliveryState(pick(o, "status", "message_status", "messageStatus", "delivery_status"));
    if (!status) return;

    const id = pick(o, "id", "message_id", "messageId", "wa_message_id", "wamid");
    // Without a wamid there is nothing to attach this to. The Wabis path guesses
    // by phone and campaign because it has to; here a missing id means the
    // payload is not what we think it is, and guessing would write a status onto
    // somebody else's message.
    if (!id) return;

    // Meta redelivers, and one batch can carry the same id twice.
    const key = `${id}:${status}`;
    if (seen.has(key)) return;
    seen.add(key);

    const error = Array.isArray(o.errors) ? asObject(o.errors[0]) : null;
    out.push({
      providerMessageId: id,
      status,
      occurredAt: parseWaTimestamp(o.timestamp ?? o.status_timestamp ?? o.occurredAt),
      errorCode: error ? pick(error, "code", "error_code") : pick(o, "error_code", "errorCode"),
      errorMessage: error
        ? pick(error, "title", "message", "details") ?? errorDetail(error)
        : pick(o, "error_message", "errorMessage"),
    });
  };

  // Meta's own shape is entry[] -> changes[] -> value -> statuses[], and each
  // array hop costs a level as well as each object, so this reaches deeper than
  // the nesting looks. Bounded only to stop a cyclic or adversarial body walking
  // forever — not to express any expectation about the envelope.
  const walk = (node: unknown, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, depth + 1));
      return;
    }
    const o = asObject(node);
    if (!o) return;

    if (Array.isArray(o.statuses)) o.statuses.forEach(consider);
    for (const key of ["entry", "changes", "value", "data", "payload"]) {
      if (key in o) walk(o[key], depth + 1);
    }
    // A bare status object posted directly, which is what a hand-run curl and
    // some relays produce.
    if (!("statuses" in o)) consider(o);
  };

  walk(body, 0);
  return out;
}

/** Meta buries the useful sentence under `error_data.details`. */
function errorDetail(error: Record<string, unknown>): string | null {
  const data = asObject(error.error_data);
  return data ? pick(data, "details") : null;
}

export type DeliveryStatusSummary = { received: number; applied: number; unmatched: number; ignored: number };

/**
 * Record what Meta told us about messages we sent.
 *
 * Applied forward-only, in the database rather than in a read-modify-write, so
 * two callbacks arriving at once cannot race each other into the wrong order.
 * `updateMany` with the rank condition in the WHERE is what makes that true —
 * a row already at a later stage simply matches nothing.
 */
export async function applyDeliveryStatuses(updates: readonly WaDeliveryUpdate[]): Promise<DeliveryStatusSummary> {
  const summary: DeliveryStatusSummary = { received: updates.length, applied: 0, unmatched: 0, ignored: 0 };

  for (const update of updates) {
    // Which states this one is allowed to supersede. Computed here so the guard
    // travels with the write instead of depending on what we read a moment ago.
    const supersedes = (Object.keys(RANK) as WaDeliveryState[]).filter((s) => RANK[s] < RANK[update.status]);

    try {
      const result = await prisma.waMessage.updateMany({
        where: {
          providerMessageId: update.providerMessageId,
          OR: [{ waStatus: null }, { waStatus: { in: supersedes } }],
        },
        data: {
          waStatus: update.status,
          waStatusAt: update.occurredAt ?? new Date(),
          // Only ever set alongside a failure, and cleared on recovery — a stale
          // code beside a delivered tick would be read as "delivered, but".
          waErrorCode: update.status === "failed" ? update.errorCode : null,
          waErrorMessage: update.status === "failed" ? update.errorMessage : null,
        },
      });

      if (result.count > 0) {
        summary.applied += result.count;
        continue;
      }

      // Nothing changed. Either we do not know this message — a send from
      // another tool on the same number, or one that predates this feature — or
      // the row is already further along. Separated because the first is worth
      // investigating and the second is the guard working.
      const exists = await prisma.waMessage.count({
        where: { providerMessageId: update.providerMessageId },
      });
      if (exists > 0) summary.ignored++;
      else summary.unmatched++;
    } catch (e) {
      logger.warn("wa_delivery_status_failed", {
        status: update.status,
        message: e instanceof Error ? e.message : String(e),
      });
      summary.unmatched++;
    }
  }

  // A re-marketing touch on the Cloud transport also has an outbox row keyed by
  // this wamid: mirror the status onto it (so Campaign Delivery reflects the true
  // outcome) and, on a hard failure, stop the drip. Dynamically imported to break
  // the wa/ ↔ crm-remarketing cycle (crm-remarketing imports wa/*), and best-effort
  // so a re-marketing hiccup never disturbs the inbox's own status write above.
  try {
    const { handleCloudDeliveryStatuses } = await import("../crm-remarketing");
    await handleCloudDeliveryStatuses(updates);
  } catch (e) {
    logger.warn("wa_delivery_remarketing_hook_failed", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return summary;
}
