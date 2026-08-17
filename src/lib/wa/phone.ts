// How a WhatsApp id becomes a phone number — deliberately its own module, and
// deliberately NOT the CRM's shared normalizePhone.
import { normalizePhone } from "../crm";

/**
 * A WhatsApp id as E.164.
 *
 * Both providers identify a person by wa_id: Meta sends it as the `from` on
 * every inbound webhook, Wabis calls it `chat_id`. It is a bare international
 * number with no `+` — country code always present, because that is what makes
 * it a WhatsApp identity. So there is no country to infer here, and inferring
 * one corrupts.
 *
 * `normalizePhone` infers one. It reads a bare ten-digit number as an Indian
 * mobile, which is correct everywhere it is used — a BDE typing a lead's number
 * means the domestic one — and wrong for a wa_id. Ten digits is every Singapore
 * number (+65 and an eight-digit subscriber number), and also reaches Norway,
 * Denmark, New Zealand and Iceland. The result is not a rejected value that
 * shows up as an error:
 *
 *     Singapore   6590000001  ->  +916590000001
 *     India      916590000001 ->  +916590000001
 *
 * The same value. `phoneE164` is a conversation's identity and how leads are
 * matched, so those two people share one thread: a stranger's messages appear
 * under an unrelated candidate, that candidate's consultant reads them, and the
 * reply is addressed to the Indian number — delivered to someone who never wrote.
 *
 * Indian numbers are unaffected either way; a wa_id for one is twelve digits and
 * both readings agree. This only changes the cases the old reading got wrong.
 *
 * Returns null for an implausible length rather than guessing at it. A number we
 * decline is a visible failure. A number we invent is a silent one.
 */
export function waIdToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  // A leading `00` is an international access code — the dialled spelling of
  // `+` — and E.164 carries no leading zeros after the country code, so
  // stripping the run is safe and lands both spellings on one value.
  const bare = digits.replace(/^0+/, "");
  if (bare.length < 8 || bare.length > 15) return null;
  return `+${bare}`;
}

/**
 * A phone number as a HUMAN typed it — where the domestic default IS the right
 * reading, because someone entering a local mobile means the local one.
 *
 * Exists so the distinction is visible at the call site: anything arriving from
 * a provider goes through `waIdToE164`, anything arriving from a keyboard comes
 * through here. Naming both makes choosing the wrong one a deliberate act rather
 * than the path of least resistance.
 */
export function typedPhoneToE164(raw: string | null | undefined): string | null {
  return normalizePhone(raw);
}
